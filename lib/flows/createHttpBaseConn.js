import axios from "axios";
import fs from "fs";
import yaml from "js-yaml";
import chalk from "chalk";
import { withRetry } from "../utils/withRetry.js";
import { PREFIX_STANDARD } from "../constants/prefix.js";

const POLL_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 10;  // 10 × 30s = 5 min

/**
 * Returns an HTTP API streaming base connection ID.
 * Reuses an existing connection by name if already enabled (no polling).
 * Creates a new one otherwise, polling up to 5 minutes for enabled state.
 */
export async function createHttpBaseConn(accessToken, envMap, sourceConfigPath) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const sourceConfigRaw = fs.readFileSync(sourceConfigPath, "utf8")
    .replace(/\{PREFIX_NAME\}/g, PREFIX_STANDARD);
  const sourceConfig = yaml.load(sourceConfigRaw);

  const connName = sourceConfig.name;
  const baseUrl = "https://platform.adobe.io/data/foundation/flowservice/connections";
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
  };

  // Reuse existing connection if already enabled — single check, no polling
  try {
    const lookup = await axios.get(`${baseUrl}?property=name=="${connName}"`, { headers });
    const items = lookup.data?.items ?? [];
    if (items.length > 0) {
      const id = items[0].id;
      const getResponse = await axios.get(`${baseUrl}/${id}`, { headers });
      const conn = getResponse.data?.items?.[0] ?? getResponse.data;
      if (conn?.state === "enabled" && conn?.auth?.params?.inletUrl) {
        console.log(chalk.green("  ✓") + " Reusing existing base connection");
        return { id, inletUrl: conn.auth.params.inletUrl, reused: true };
      }
      console.log(chalk.yellow("  !") + " Existing base connection is not enabled — falling through to create");
    }
  } catch {
    // Fall through to create
  }

  const payload = { ...sourceConfig.baseConnConfig, name: connName, description: "HTTP API streaming base connection" };

  try {
    return await withRetry(async () => {
      const response = await axios.post(baseUrl, payload, { headers });

      if (response.status === 201) {
        console.log(
          chalk.green("  ✓") +
            " Base connection created — polling for enabled state (up to 5 min)"
        );

        const id = response.data.id;
        let inletUrl;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          console.log(
            chalk.gray(
              `    polling attempt ${attempt + 1}/${MAX_ATTEMPTS}...`
            )
          );

          const getResponse = await axios.get(`${baseUrl}/${id}`, { headers });
          const conn = getResponse.data?.items?.[0] ?? getResponse.data;

          if (conn?.state === "enabled" && conn?.auth?.params?.inletUrl) {
            inletUrl = conn.auth.params.inletUrl;
            console.log(chalk.green("    ✓") + " Base connection enabled");
            break;
          }

          if (attempt < MAX_ATTEMPTS - 1) {
            const remainingSec =
              ((MAX_ATTEMPTS - attempt - 1) * POLL_INTERVAL_MS) / 1000;

            console.log(
              chalk.gray(`    not yet active, ~${remainingSec}s remaining`)
            );

            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          }
        }

        if (!inletUrl) {
          throw new Error(
            "Base connection created but did not reach enabled state with inletUrl after 5 minutes"
          );
        }

        return { id, inletUrl, reused: false };
      }

      throw new Error(`Unexpected status ${response.status}`);
    }, 3, 2000);
  } catch {
    return null;
  }
}
