import fs from "fs";
import path from "path";
import { select } from "@inquirer/prompts";

let _industry = null;

export async function getSelectedIndustry() {
  if (_industry) return _industry;
  const root = path.resolve(process.cwd(), "industry");
  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory()
      && !d.name.startsWith("_")
      && !d.name.startsWith(".")
      && d.name !== "sources")
    .map(d => d.name);
  if (dirs.length === 0) throw new Error("No industries found under industry/");
  if (dirs.length === 1) { _industry = dirs[0]; return _industry; }
  _industry = await select({
    message: "Select industry:",
    choices: dirs.map(d => ({ name: d, value: d })),
  });
  return _industry;
}
