import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import chalk from "chalk";
import { uploadToDLZ } from "../../lib/flows/uploadToDLZ.js";
import { getAccessToken } from "../../lib/env/getAccessToken.js";
import { getValidEnvContext } from "../../lib/env/envContext.js";
import { getSelectedIndustry } from "../../lib/env/getIndustry.js";
import { buildDlzSourceMetadata } from "../../lib/flows/buildDlzSourceMetadata.js";
import { createDataFlows } from "../../lib/flows/bulkCreateDataFlows.js";
import { checkRelationalDatasetStatus } from "../../lib/datasets/checkRelationalDatasetStatus.js";
import { enableRelationalDataset } from "../../lib/datasets/enableRelationalDataset.js";
import { logDone } from "../../lib/utils/logDone.js";

const POLL_INTERVAL_MS = 30_000;
const MAX_POLLS = 30; // 30 × 30s = 15 minutes

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export async function loadRelationalData() {
  try {
    const context = await getValidEnvContext();
    if (!context) return;

    const { envMap } = context;

    const accessToken = await getAccessToken(envMap);
    if (!accessToken) {
      console.log(chalk.red("  ✗") + " No access token provided.");
      return;
    }

    const startTime = Date.now();
    const industry = await getSelectedIndustry();
    const deployYamlPath = path.resolve(process.cwd(), "industry", industry, "lab-packs", "ajo-foundations", "deploy.yaml");
    const fileConfigs = path.resolve(process.cwd(), "industry", industry, "relational", "data-load.yaml");
    const dlzConfig = path.resolve(process.cwd(), "industry", "sources", "dlz.yaml");
    const mappingSetDir = path.resolve(process.cwd(), "industry", industry, "relational", "mapping-sets");

    const deployYaml = yaml.load(fs.readFileSync(deployYamlPath, "utf8"));
    const dataLoadRefs = deployYaml.relational?.dataLoad || [];
    const datasets = await buildDlzSourceMetadata(accessToken, envMap, fileConfigs, dataLoadRefs);
    if (!datasets) {
      console.log(chalk.red("  ✗") + " Could not look up datasets");
      return;
    }

    // Initial status check across all datasets
    const statusMap = new Map();
    for (const [name, { datasetId }] of datasets) {
      statusMap.set(name, await checkRelationalDatasetStatus(accessToken, envMap, datasetId));
    }

    // Abort immediately if anything already FAILED
    const initialFailed = [...statusMap.entries()].filter(([, ext]) => ext?.status === "FAILED");
    if (initialFailed.length > 0) {
      console.log(chalk.red("  ✗") + " Some relational datasets failed to enable:");
      for (const [name] of initialFailed) {
        console.log(chalk.red("    ✗") + `  ${name}`);
      }
      console.log("  Try re-running, or enable manually in the Adobe Experience Platform UI.\n");
      return;
    }

    const totalCount = statusMap.size;

    // Pending = everything not yet COMPLETED (needs enabling + already IN_PROGRESS)
    const pending = new Set(
      [...statusMap.entries()]
        .filter(([, ext]) => !(ext?.enabled === true && ext?.status === "COMPLETED"))
        .map(([name]) => name)
    );
    const alreadyEnabledCount = totalCount - pending.size;

    if (pending.size === 0) {
      console.log(chalk.green("  ✓") + ` All ${totalCount} relational datasets already enabled`);
    } else {
      const suffix = alreadyEnabledCount > 0 ? ` — ${alreadyEnabledCount} of ${totalCount} already enabled` : "";
      console.log(`\n  Activating relational datasets${suffix} (max 15 min)...`);

      // Auto-enable any datasets that haven't been enabled yet
      const notEnabled = [...statusMap.entries()].filter(([, ext]) => !ext);
      for (const [name] of notEnabled) {
        await enableRelationalDataset(accessToken, envMap, datasets.get(name).datasetId);
      }

      let allReady = false;

      for (let poll = 0; poll < MAX_POLLS; poll++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const elapsed = formatElapsed(Date.now() - startTime);
        const nowFailed = [];

        for (const name of [...pending]) {
          const ext = await checkRelationalDatasetStatus(accessToken, envMap, datasets.get(name).datasetId);
          if (ext?.enabled === true && ext?.status === "COMPLETED") {
            pending.delete(name);
          } else if (ext?.status === "FAILED") {
            nowFailed.push(name);
          }
        }

        if (nowFailed.length > 0) {
          console.log(chalk.red("  ✗") + " Some relational datasets failed to enable:");
          for (const name of nowFailed) {
            console.log(chalk.red("    ✗") + `  ${name}`);
          }
          console.log("  Try re-running, or enable manually in the Adobe Experience Platform UI.\n");
          return;
        }

        if (pending.size === 0) {
          console.log(chalk.green("    ✓") + ` All ${totalCount} relational datasets enabled (${elapsed})`);
          allReady = true;
          break;
        }

        console.log(`    ${elapsed} elapsed — ${pending.size} datasets remaining`);
      }

      if (!allReady) {
        console.log(chalk.red("  ✗") + " Relational datasets did not enable within 15 minutes:");
        for (const name of pending) {
          console.log(chalk.red("    ✗") + `  ${name}`);
        }
        console.log("  Try re-running, or enable manually in the Adobe Experience Platform UI.\n");
        return;
      }
    }

    // Data load
    const pause = () => new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("  Uploading files to DLZ...");
    const loadComplete = await uploadToDLZ(accessToken, envMap, datasets);
    if (!loadComplete) {
      console.log(chalk.red("  ✗") + " File upload failed");
      return;
    }
    await pause();

    console.log("  Creating dataflows...");
    const dataflow = await createDataFlows({
      accessToken,
      envMap,
      sourceConfigPath: dlzConfig,
      mappingSetDir,
      sourceDatasets: datasets,
      options: { type: "relational"}
    });

    if (!dataflow) {
      console.log(chalk.red("  ✗") + " Dataflow creation failed");
      return;
    }
    console.log("\nRelational data load complete.");
    console.log("Data should be available within ~10 minutes.");
    logDone(startTime);

  } catch (err) {
    console.log(chalk.red("  ✗") + ` ${err.message}`);
  }
}
