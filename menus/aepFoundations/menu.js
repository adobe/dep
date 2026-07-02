import { numberedMenuPrompt } from "../../lib/prompts/numberedMenuPrompt.js";
import { createProfileBase } from "./createProfileBase.js";
import { loadProfileData } from "./loadProfileData.js";
import { checkProfileHealth } from "./checkProfileHealth.js";
import { cleanSandbox } from "./cleanSandbox.js";

export async function aepFoundationsMenu() {
  console.log("\nAEP Foundations selected...\n");

  const choices = [
    {
      name: "Create profile base",
      action: createProfileBase,
    },
    {
      name: "Load profile data",
      action: loadProfileData,
    },
    {
      name: "Check profile health",
      action: checkProfileHealth,
    },
  ];

  const pinnedChoices = [
    { key: "c", name: "Clean sandbox", action: cleanSandbox },
    {
      key: "b",
      name: 'Go back to "Main Menu"',
      action: async () => {
        console.log("\n🔙 Returning to Main Menu...\n");
      },
    },
  ];

  while (true) {
    const selection = await numberedMenuPrompt(choices, "AEP Foundations Menu", pinnedChoices);

    if (typeof selection.action === "function") {
      await selection.action();

      if (selection.name.includes("back")) {
        break;
      }
    } else {
      console.error("❌ Error: selected item has no valid action.");
    }
  }
}
