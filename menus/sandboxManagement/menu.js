import { numberedMenuPrompt } from "../../lib/prompts/numberedMenuPrompt.js";
import { reset } from "./reset.js";

export async function sandboxManagementMenu() {
  console.log("\nSandbox Management selected...\n");

  const choices = [
    {
      name: "Reset",
      action: reset,
    },
  ];

  const pinnedChoices = [
    {
      key: "b",
      name: 'Go back to "Main Menu"',
      action: async () => {
        console.log("\n🔙 Returning to Main Menu...\n");
      },
    },
  ];

  while (true) {
    const selection = await numberedMenuPrompt(choices, "Sandbox Management Menu", pinnedChoices);

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
