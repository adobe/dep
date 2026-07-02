import { resetEnvSession } from "./lib/env/envContext.js"
import { numberedMenuPrompt } from "./lib/prompts/numberedMenuPrompt.js"
import { aepFoundationsMenu } from "./menus/aepFoundations/menu.js";
import { ajoArchFoundationsMenu } from "./menus/ajoArchFoundations/menu.js";
import { sandboxManagementMenu } from "./menus/sandboxManagement/menu.js";
import { getSelectedIndustry } from "./lib/env/getIndustry.js";

// Reset env session on app start
resetEnvSession();

//Suppress Random Warnings
const originalStderrWrite = process.stderr.write;

process.stderr.write = (chunk, encoding, callback) => {
  const str = typeof chunk === "string" ? chunk : chunk.toString();

  // Suppress only the specific deprecation warning
  if (str.includes("[DEP0176] DeprecationWarning: fs.F_OK is deprecated")) {
    return true; // Don't write to stderr
  }

  // Pass through anything else
  return originalStderrWrite.call(process.stderr, chunk, encoding, callback);
};

console.log("\nStarting the DEP CLI...\n")



const choices = [
  {
    name: "AEP foundations",
    action: aepFoundationsMenu,
  },
  {
    name: "AJO arch foundations",
    action: ajoArchFoundationsMenu,
  },
  {
    name: "Sandbox management",
    action: sandboxManagementMenu,
  },
  {
    name: "Exit\n",
    action: () => {
      console.log("\nPeace out...\n");
      process.exit(0);
    },
  },
];

// Initiate Prompt
async function runApp() {
  await getSelectedIndustry();
  while (true) {
    const selection = await numberedMenuPrompt(choices, "Main Menu");

    if (typeof selection.action === "function") {
      await selection.action();
    } else {
      console.error("❌ Error: selected item has no valid action.");
    }
  }
}

runApp();


