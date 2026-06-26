import chalk from "chalk";
import { safeConfirm, safeInput } from "../../lib/prompts/promptSafe.js";
import { askConfirmDestructive } from "../../lib/prompts/continuePrompt.js";
import { getAccessToken } from "../../lib/env/getAccessToken.js";
import { getValidEnvContext } from "../../lib/env/envContext.js";
import { resetSandbox } from "../../lib/sandbox/resetSandbox.js";

// --------------------------------------------------------
// --- Main Function
// --------------------------------------------------------
export async function reset() {
  try {
    const context = await getValidEnvContext();
    if (!context) return;

    const { envMap } = context;

    const accessToken = await getAccessToken(envMap);
    if (!accessToken) {
      console.log(chalk.red("  ✗") + " No access token provided.");
      return;
    }

    let resetSandboxName;

    const currentSandbox = await safeConfirm(`Reset current sandbox ${envMap.SANDBOX_NAME}?`, false);

    if (currentSandbox) {
      resetSandboxName = envMap.SANDBOX_NAME;
    } else {
      resetSandboxName = await safeInput("Enter the name of the sandbox you want to reset:");
    }

    if (resetSandboxName.length > 0) {
      const confirmation = await askConfirmDestructive(`reset sandbox "${resetSandboxName}"`);

      if (confirmation) {
        const resetStatus = await resetSandbox(envMap, accessToken, resetSandboxName);
        if (!resetStatus) {
          console.log(chalk.red("\n  ✗") + " Sandbox reset failed.");
        } else {
          console.log(chalk.green("\n  ✓") + ` Sandbox reset of "${resetSandboxName}" initiated. Please wait 120 minutes before use.`);
          console.log("  Timestamp:", new Date().toISOString());
        }
      }
    } else {
      console.log(chalk.yellow("  !") + " No sandbox name provided.");
    }
  } catch (err) {
    console.log(chalk.red("  ✗") + ` ${err.message}`);
  }
}