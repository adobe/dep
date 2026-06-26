import { confirm, input } from "@inquirer/prompts";
import chalk from "chalk";

function handleExit(err) {
  if (err?.name === "ExitPromptError") {
    console.log(chalk.yellow("\n  !") + " Prompt closed. Exiting...\n");
    process.exit(0);
  }
  throw err;
}

export async function safeConfirm(message, defaultValue = false) {
  try {
    return await confirm({ message, default: defaultValue });
  } catch (err) {
    handleExit(err);
  }
}

export async function safeInput(message) {
  try {
    return await input({ message });
  } catch (err) {
    handleExit(err);
  }
}
