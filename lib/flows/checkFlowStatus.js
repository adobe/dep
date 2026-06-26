import axios from "axios";
import chalk from "chalk";

const FLOW_INITIALIZATION_DELAY_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits 5 minutes for flows to initialize, then verifies they are enabled.
 *
 * @param {string} accessToken
 * @param {Object} envMap
 * @param {string[]} flowIds
 * @returns {{ allActive: boolean, results: Array<{ id: string, state: string }> }}
 */
export async function checkFlowStatus(accessToken, envMap, flowIds) {
  if (!flowIds?.length) {
    return { allActive: true, results: [] };
  }

  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
  };

  console.log(chalk.gray("    Initialization in progress... ~5m remaining"));

  for (let min = 4; min >= 1; min--) {
    await sleep(60_000);

    console.log(
      chalk.gray(`    Initialization in progress... ~${min}m remaining`)
    );
  }

  await sleep(60_000);

  console.log(
    chalk.gray("    Initialization complete. Verifying flow status...")
  );

  const stateMap = new Map(flowIds.map((id) => [id, "unknown"]));

  const response = await axios.get(
    "https://platform.adobe.io/data/foundation/flowservice/flows?limit=100",
    { headers }
  );

  for (const item of response.data?.items ?? []) {
    if (stateMap.has(item.id)) {
      stateMap.set(item.id, item.state);
    }
  }

  const results = [...stateMap.entries()].map(([id, state]) => ({
    id,
    state,
  }));

  const failedFlows = results.filter((r) => r.state !== "enabled");

  if (failedFlows.length) {
    console.log(
      chalk.red("  ✗") +
        ` ${failedFlows.length} of ${flowIds.length} flow(s) failed to initialize`
    );

    return {
      allActive: false,
      results,
    };
  }

  console.log(
    chalk.green("  ✓") +
      ` All ${flowIds.length} flow(s) initialized successfully`
  );

  return {
    allActive: true,
    results,
  };
}