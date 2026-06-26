import path from "path";
import chalk from "chalk";
import { getAccessToken } from "../../lib/env/getAccessToken.js";
import { getValidEnvContext } from "../../lib/env/envContext.js";
import { getSelectedIndustry } from "../../lib/env/getIndustry.js";
import { checkSandboxReady } from "../../lib/env/checkSandboxReady.js";
import { deploySchemaModel } from "../../lib/schemas/deploySchemaModel.js";
import { enableRelationalDataset } from "../../lib/datasets/enableRelationalDataset.js";
import { askConfirmGeneric } from "../../lib/prompts/continuePrompt.js";
import { logDone } from "../../lib/utils/logDone.js";

export async function createRelationalBase() {
  try {
    const context = await getValidEnvContext();
    if (!context) return;

    const { envMap } = context;
    const accessToken = await getAccessToken(envMap);
    if (!accessToken) {
      console.log(chalk.red("  ✗") + " No access token provided.");
      return;
    }

    const ready = await checkSandboxReady(envMap, accessToken, 120);
    if (!ready) return;

    const enableRelational = await askConfirmGeneric(
      "Enable datasets for AJO relational store?"
    );

    const startTime = Date.now();
    const industry = await getSelectedIndustry();
    const deployYamlPath = path.resolve(process.cwd(), "industry", industry, "lab-packs", "ajo-foundations", "deploy.yaml");

    let result;
    try {
      result = await deploySchemaModel(deployYamlPath, envMap, accessToken, { type: "relational" });
    } catch {
      return; // deploySchemaModel already logged the error
    }
    if (!result) return;

    if (enableRelational) {
      const datasetEntries = Object.entries(result.datasets || {});
      if (datasetEntries.length > 0) {
        console.log("\n  Enabling datasets for AJO relational store...");
        let enabled = 0;
        let alreadyEnabled = 0;
        const failedNames = [];
        for (const [name, datasetId] of datasetEntries) {
          try {
            const enableResult = await enableRelationalDataset(accessToken, envMap, datasetId);
            enabled++;
            if (enableResult?.alreadyEnabled) alreadyEnabled++;
          } catch {
            failedNames.push(name);
          }
        }
        const total = datasetEntries.length;
        const allEnabled = failedNames.length === 0;
        const suffix = failedNames.length > 0
          ? ` — ${failedNames.length} failed to enable`
          : alreadyEnabled > 0 ? ` — ${alreadyEnabled} already enabled` : "";
        console.log(
          (allEnabled ? chalk.green("  ✓") : chalk.red("  ✗")) +
          ` Datasets enabled for relational store (${enabled}/${total}${suffix})`
        );
        for (const name of failedNames) {
          console.log(chalk.red("    ✗") + `  ${name}`);
        }
        console.log();
      }
    }
    logDone(startTime);
  } catch (err) {
    console.log(chalk.red("  ✗") + ` ${err.message}`);
  }
}
