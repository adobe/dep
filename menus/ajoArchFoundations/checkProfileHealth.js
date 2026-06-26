import path from "path";
import chalk from "chalk";
import { getAccessToken } from "../../lib/env/getAccessToken.js";
import { getValidEnvContext } from "../../lib/env/envContext.js";
import { checkSandboxReady } from "../../lib/env/checkSandboxReady.js";
import { getSelectedIndustry } from "../../lib/env/getIndustry.js";
import { checkProfileHealth as runHealthChecks } from "../../lib/profileService/checkProfileHealth.js";

export async function checkProfileHealth() {
  try {
    const context = await getValidEnvContext();
    if (!context) return;

    const { envMap } = context;
    const accessToken = await getAccessToken(envMap);
    if (!accessToken) {
      console.log(chalk.red("  ✗") + " No access token provided.");
      return;
    }

    const ready = await checkSandboxReady(envMap, accessToken);
    if (!ready) return;

    const industry = await getSelectedIndustry();
    const healthConfigPath = path.resolve(process.cwd(), "industry", industry, "lab-packs", "ajo-foundations", "health.yaml");

    console.log("\n  Running profile health checks...\n");
    const { passed, results } = await runHealthChecks(accessToken, envMap, healthConfigPath);

    for (const { label, pass, children } of results) {
      const icon = pass ? chalk.green("  ✓") : chalk.red("  ✗");
      console.log(`${icon} ${label}`);
      if (children) {
        for (const child of children) {
          console.log(chalk.red("    ✗") + ` ${child.label}`);
        }
      }
    }

    console.log();
    if (passed) {
      console.log(chalk.green("  ✓") + " All health checks passed.\n");
    } else {
      console.log(chalk.red("  ✗") + " Health check failed — wait 15 minutes and retry.\n");
    }
  } catch (err) {
    console.log(chalk.red("  ✗") + ` ${err.message}`);
  }
}
