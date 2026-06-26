import fs from "fs";
import path from "path";
import chalk from "chalk";
import { safeConfirm, safeInput } from "../prompts/promptSafe.js";
import readline from "readline";


// path to session environment file
const sessionEnvPath = path.join(process.cwd(), "/lib/env/session.json");

// ------------------------------------------------------------------
// --- SESSIONS FILE UTILITIES
// ------------------------------------------------------------------

// reset the path to 'null' for the user environment file path
export function resetEnvSession() {
  fs.writeFileSync(sessionEnvPath, JSON.stringify({ envFilePath: null, envMap: null }, null, 2));
}

// get the stored session environment file path and sandbox
function getStoredEnvSession() {
  if (!fs.existsSync(sessionEnvPath)) return { envFilePath: null, envMap: null };

  try {
    const { envFilePath, envMap } = JSON.parse(fs.readFileSync(sessionEnvPath, "utf8"));
    return {
      envFilePath: envFilePath || null,
      envMap: envMap || null
    };
  } catch {
    return { envFilePath: null, envMap: null };
  }
}


// store the user env file path for the session
function storeEnvFileDetails(envFilePath, envMap) {
  fs.writeFileSync(
    sessionEnvPath,
    JSON.stringify({ envFilePath, envMap }, null, 2)
  );
}

// Clear previous prompt line to prevent ✔ from showing
function clearLastPromptLine() {
  readline.moveCursor(process.stdout, 0, -1); // up one line
  readline.clearLine(process.stdout, 0); // clear entire line
  readline.cursorTo(process.stdout, 0); // move cursor to start
}




// ------------------------------------------------------------------
// ---  ENV FILE VALIDATION AND MAP BUILDER
// ------------------------------------------------------------------

function resolveEnvFilePath(fileName) {
  return path.join(process.cwd(), "envFiles", path.basename(fileName));
}

function buildEnvMap(envJson) {
  let envMap = {};
  envJson.values?.forEach(({ key, value }) => {
    if (key && value !== undefined) {
      envMap[key] = value.toString().trim();
    }
  });

  // required env file fields
  const requiredEnvVars = [
    "CLIENT_SECRET",
    "API_KEY",
    "IMS",
    "IMS_ORG",
    "SANDBOX_NAME",
    "SCOPES",
  ];
  const missing = requiredEnvVars.filter((key) => !envMap[key]);

  if (missing.length > 0) {
    clearLastPromptLine();
    console.log(chalk.red("  ✗") + ` These variables are missing or empty in your environment file: ${missing.join(", ")}`);
    return false;
  }


  // Validate IMS_ORG ends with @AdobeOrg
  if (!envMap.IMS_ORG.endsWith("@AdobeOrg")) {
    console.log(chalk.red("  ✗") + ` IMS_ORG must end with "@AdobeOrg". Current value: ${envMap.IMS_ORG}`);
    return false;
  }

  return envMap;
}




// ------------------------------------------------------------------
// ---  MAIN ENTRY POINT
// ------------------------------------------------------------------
export async function getValidEnvContext() {
  let envFilePath;
  let envMap;
  let useExistingEnvFile = false;
  let useExistingSandbox = false;
  let result;
  const { envFilePath: storedPath, envMap: storedEnvMap } = getStoredEnvSession();

  //if session env details exist prompt for re-use
  if (storedPath) {
    const filename = path.basename(storedPath);
    useExistingEnvFile = await safeConfirm(`Reuse same environment file (${filename})?`, true);
  }

  //use existing session env details
  if(useExistingEnvFile){
      console.log("\nReusing the same environment file...\n");
      envFilePath = storedPath;
      envMap = storedEnvMap;
      // prompt to use same sandbox
      useExistingSandbox = await safeConfirm(`Reuse same sandbox (${storedEnvMap.SANDBOX_NAME})?`, true);

      // Prompt for SANDBOX_NAME override
      if(!useExistingSandbox){
        envMap = await overrideSandbox(storedEnvMap);
        storeEnvFileDetails(storedPath, envMap);
      }



  //ask for new session details
  } else {
    result = await promptAndLoadEnvFile();
    if (!result) return;
    envFilePath = result.envFilePath;
    envMap = result.envMap;
  }

  return { envFilePath, envMap };
}



// ------------------------------------------------------------------
// --- PROMPT AND VALIDATE NEW ENVIRONMENT FILE
// ------------------------------------------------------------------
async function promptAndLoadEnvFile() {
  while (true) {

    let initialEnvFilePath;
    let finalEnvFilePath;

    // prompt for environment file
    initialEnvFilePath = await safeInput("Enter your environment file name (e.g. myconfig-env.json):");

    // exit if they type back or exit
    if (initialEnvFilePath.trim().toLowerCase() === "back" || initialEnvFilePath.trim().toLowerCase() === "exit") {
      clearLastPromptLine();
      console.log("Returning to main menu...\n");
      return null;
    }

    // validate new file ends in .json
    if (!initialEnvFilePath.endsWith(".json")) {
      clearLastPromptLine();
      console.log(chalk.red("  ✗") + ' Your environment file must end with ".json"\n');
      continue;
    }

    // resolve environment file path
    finalEnvFilePath = resolveEnvFilePath(initialEnvFilePath);
    if (!fs.existsSync(finalEnvFilePath)) {
      clearLastPromptLine();
      console.log(chalk.red("  ✗") + ` File not found at ${finalEnvFilePath}\n`);
      continue;
    }

    // Try loading and validating the file
    let evnFileJson;
    try {
      evnFileJson = JSON.parse(fs.readFileSync(finalEnvFilePath, "utf8"));
    } catch (e) {
      clearLastPromptLine();
      console.log(chalk.red("  ✗") + ` Failed to parse JSON in ${path.basename(finalEnvFilePath)}: ${e.message}\n`);
      continue;
    }

    let envMap = buildEnvMap(evnFileJson);
    if(!envMap){
      console.log(chalk.red("  ✗") + ' Please enter a valid file to continue or type "exit"\n');
      continue;
    }

    // Prompt for optional SANDBOX_NAME override
    envMap = await overrideSandbox(envMap);

    console.log(chalk.green("  ✓") + ` Environment file (${path.basename(finalEnvFilePath)}) stored for session\n`);

    storeEnvFileDetails(finalEnvFilePath, envMap);

    return { envFilePath: finalEnvFilePath, envMap };
  }
}



// ------------------------------------------------------------------
// --- SANDBOX OVERRIDE
// ------------------------------------------------------------------
async function overrideSandbox(envMap) {
  const sandboxOverride = await safeInput(`Enter a sandbox name (or leave blank to use ${envMap["SANDBOX_NAME"]}):`);

  if (sandboxOverride?.trim()) {
    envMap["SANDBOX_NAME"] = sandboxOverride.trim();
  }
  return envMap;
}
