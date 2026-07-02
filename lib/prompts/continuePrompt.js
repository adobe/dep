import { safeConfirm } from "./promptSafe.js";

export async function askConfirm(mins) {
  console.log();
  return safeConfirm(`This process takes ${mins} minutes to complete. Continue?`, false);
}

export async function askConfirmDestructive(name) {
  console.log();
  return safeConfirm(`This is a destructive change. Are you sure you want to ${name}?`, false);
}

export async function askConfirmGeneric(message) {
  console.log();
  return safeConfirm(message, false);
}
