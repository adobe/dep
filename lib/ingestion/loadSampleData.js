import fs from "fs";

function buildDateVars() {
  const now = new Date();
  const iso = (d) => d.toISOString();
  const addDays = (base, days) => { const d = new Date(base); d.setDate(d.getDate() + days); return d; };

  const vars = {};

  // Billing periods: p1 = last month (most recent), p6 = 6 months ago (oldest)
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    vars[`p${i}_date`] = iso(d);
    vars[`p${i}_start`] = iso(d);
    vars[`p${i}_end`] = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59));
  }

  // Order events: order1 = 7 days ago, order2 = now
  vars["order1"] = iso(addDays(now, -7));
  vars["order2"] = iso(now);

  // Web events across 3 days with 5-second spacing
  const day1 = addDays(now, -14); day1.setHours(9, 0, 0, 0);
  for (let i = 1; i <= 6; i++) vars[`day1_event${i}`] = iso(new Date(day1.getTime() + (i - 1) * 5 * 1000));

  const day2 = addDays(now, -10); day2.setHours(10, 0, 0, 0);
  for (let i = 1; i <= 17; i++) vars[`day2_event${i}`] = iso(new Date(day2.getTime() + (i - 1) * 5 * 1000));

  const day3 = addDays(now, -3); day3.setHours(14, 0, 0, 0);
  for (let i = 1; i <= 10; i++) vars[`day3_event${i}`] = iso(new Date(day3.getTime() + (i - 1) * 5 * 1000));

  return vars;
}

/**
 * Reads a sample data file, resolves {{varName}} date placeholders, and parses the JSON.
 * Handles both single-object files, proper JSON arrays, and comma-separated multi-record files.
 * Always returns an array of records.
 *
 * @param {string} filePath - Absolute path to the sample data file.
 * @returns {Array<Object>}
 */
export function loadSampleData(filePath) {
  const vars = buildDateVars();
  const raw = fs.readFileSync(filePath, "utf8");
  const content = raw.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);

  // Try as-is (handles single objects and proper arrays)
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Comma-separated multi-record format — wrap in array
    const parsed = JSON.parse(`[${content}]`);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
}
