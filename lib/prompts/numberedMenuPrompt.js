import chalk from "chalk";
import { safeInput } from "./promptSafe.js";

export async function numberedMenuPrompt(choices, title, pinnedChoices = [], disabledChoices = []) {
  let selected = null;

  const promptLabel = "Enter selection:";

  while (!selected) {
    console.log(`\n${title}:`);
    let num = 1;
    choices.forEach((c) => {
      if (c.separator) {
        console.log(chalk.dim(`\n  ─── ${c.name} ───`));
      } else {
        console.log(`  ${num++}) ${c.name}`);
      }
    });
    if (disabledChoices.length) {
      disabledChoices.forEach((c) => {
        const reason = c.disabled ? chalk.dim(` ${c.disabled}`) : "";
        console.log(chalk.dim(`  ·  ${c.name}`) + reason);
      });
    }
    if (pinnedChoices.length) {
      console.log();
      pinnedChoices.forEach((p) => {
        console.log(`  ${p.key}) ${p.name}`);
      });
    }
    console.log();

    const raw = await safeInput(promptLabel);
    const trimmed = raw.trim().toLowerCase();

    const pinned = pinnedChoices.find((p) => p.key === trimmed);
    if (pinned) {
      selected = pinned;
      continue;
    }

    const selectableChoices = choices.filter((c) => !c.separator);
    const index = parseInt(trimmed, 10);
    if (!isNaN(index) && index >= 1 && index <= selectableChoices.length) {
      selected = selectableChoices[index - 1];
    } else {
      console.log(chalk.red("  ✗") + " Invalid input. Please try again.\n");
    }
  }

  return selected;
}
