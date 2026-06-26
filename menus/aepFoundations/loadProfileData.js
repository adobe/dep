import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import chalk from "chalk";
import { getAccessToken } from "../../lib/env/getAccessToken.js";
import { getValidEnvContext } from "../../lib/env/envContext.js";
import { checkSandboxReady } from "../../lib/env/checkSandboxReady.js";
import { getSelectedIndustry } from "../../lib/env/getIndustry.js";
import { buildHttpSourceMetadata } from "../../lib/flows/buildHttpSourceMetadata.js";
import { checkDatasetsReady } from "../../lib/datasets/checkDatasetsReady.js";
import { createHttpBaseConn } from "../../lib/flows/createHttpBaseConn.js";
import { createDataFlows } from "../../lib/flows/bulkCreateDataFlows.js";
import { checkFlowStatus } from "../../lib/flows/checkFlowStatus.js";
import { streamRecord } from "../../lib/ingestion/streamRecord.js";
import { loadSampleData } from "../../lib/ingestion/loadSampleData.js";
import { cleanupRouter } from "../../lib/flows/cleanup.js";
import { logDone } from "../../lib/utils/logDone.js";

export async function loadProfileData() {
  try {
    const context = await getValidEnvContext();
    if (!context) return;

    const { envMap } = context;
    const accessToken = await getAccessToken(envMap);
    if (!accessToken) {
      console.log(chalk.red("  ✗") + " No access token provided.");
      return;
    }

    const ready = await checkSandboxReady(envMap, accessToken);
    if (!ready) return;

    const startTime = Date.now();
    const industry = await getSelectedIndustry();
    const deployYamlPath = path.resolve(process.cwd(), "industry", industry, "lab-packs", "aep-foundations", "deploy.yaml");
    const packDir = path.dirname(deployYamlPath);
    const deployYaml = yaml.load(fs.readFileSync(deployYamlPath, "utf8"));
    const registryPath = path.resolve(packDir, "..", "..", "standard", "schemas.yaml");
    const dataLoadPath = path.resolve(packDir, "..", "..", "standard", "data-load.yaml");
    const dataLoad = yaml.load(fs.readFileSync(dataLoadPath, "utf8"));

    const refs = [];
    for (const raw of (deployYaml.standard?.dataLoad || [])) {
      const [schemaKey, id] = String(raw).split(":");
      if (!schemaKey || !id) {
        console.log(chalk.red("  ✗") + ` Invalid dataLoad entry "${raw}" — expected <schema-key>:<id>`);
        return;
      }
      const entry = (dataLoad.schemas?.[schemaKey] || []).find(e => e.id === id);
      if (!entry) {
        console.log(chalk.red("  ✗") + ` data-load.yaml has no entry "${schemaKey}:${id}"`);
        return;
      }
      refs.push({ schemaKey, entry });
    }
    const datasetKeys = [...new Set(refs.map(r => r.schemaKey))];
    const sourceConfigPath = path.resolve(process.cwd(), "industry", "sources", dataLoad.source + ".yaml");
    const mappingSetDir = path.resolve(packDir, "..", "..", "standard", "mapping-sets");

    console.log("\n  Gathering dataset metadata...");
    const datasets = await buildHttpSourceMetadata(accessToken, envMap, registryPath, datasetKeys);
    if (!datasets) {
      console.log(chalk.red("  ✗") + " Could not look up datasets — ensure the profile base is deployed first");
      return;
    }
    console.log(chalk.green("    ✓") + ` Found ${datasets.size} datasets`);

    const { ready: datasetsReady, notEnabled, tooRecent, maxRemainingMinutes } = checkDatasetsReady(datasets);
    if (notEnabled.length > 0) {
      for (const name of notEnabled) {
        console.log(chalk.yellow("    !") + ` ${name} — not enabled for profile`);
      }
      for (const { name, remainingMinutes } of tooRecent) {
        console.log(chalk.yellow("    !") + ` ${name} — ${remainingMinutes} minute(s) remaining`);
      }
      console.log(chalk.red("\n  ✗") + ` Re-run "Create profile base" before loading data.`);
      return;
    }
    if (tooRecent.length > 0) {
      for (const { name, remainingMinutes } of tooRecent) {
        console.log(chalk.yellow("    !") + ` ${name} — ${remainingMinutes} minute(s) remaining`);
      }
      console.log(chalk.yellow("\n  !") + ` Wait ${maxRemainingMinutes} more minute(s) before loading data.`);
      return;
    }
    console.log(chalk.green("    ✓") + " All datasets profile-enabled");

    console.log("\n  Creating HTTP API base connection...");
    const baseConn = await createHttpBaseConn(accessToken, envMap, sourceConfigPath);
    if (!baseConn) {
      console.log(chalk.red("  ✗") + " Failed to create HTTP API base connection");
      return;
    }
    const { id: baseConnectionId, inletUrl } = baseConn;

    console.log("\n  Creating dataflows...");
    const success = await createDataFlows({
      accessToken,
      envMap,
      sourceConfigPath,
      mappingSetDir,
      sourceDatasets: datasets,
      options: { type: "standard", baseConnectionId, forceRecreate: true },
    });
    if (!success) {
      console.log(chalk.red("\n  ✗") + " Dataflow creation failed");
      return;
    }

    console.log("\n  Waiting 5 minutes for flows to initialize...");
    const flowIds = [...datasets.values()].map((r) => r.dataflowId).filter(Boolean);
    const { allActive, results: flowResults } = await checkFlowStatus(accessToken, envMap, flowIds);

    if (!allActive) {
      console.log(chalk.red("  ✗") + " Flows did not become active within 5 minutes");
      for (const { id, state } of flowResults) {
        console.log(`    ${id}: ${state}`);
      }
      console.log("\n  Rolling back...");
      const sourceIds = [...datasets.values()].map((r) => r.sourceConnectionId).filter(Boolean);
      const targetIds = [...datasets.values()].map((r) => r.targetConnectionId).filter(Boolean);
      const dataflowIds = [...datasets.values()].map((r) => r.dataflowId).filter(Boolean);
      const rolled = await cleanupRouter(accessToken, envMap, sourceIds, targetIds, [], dataflowIds);
      if (!rolled) console.log(chalk.yellow("  !") + " Some artifacts could not be deleted — check Flow Service");
      return;
    }
    console.log(chalk.green("  ✓") + " All flows active");

    const bySchemaKey = new Map([...datasets.values()].map((r) => [r.schemaKey, r]));

    console.log("\n  Streaming lab data...");

    const groupOrder = [];
    const personaGroups = new Map();

    for (const { schemaKey, entry } of refs) {
      const record = bySchemaKey.get(schemaKey);
      if (!record) continue;
      const { file, mode } = entry;
      const dir = path.basename(path.dirname(file));
      const label = dir === "sample-data"
        ? "Lookup data"
        : dir.replace(/-profiles?$/, "").split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
      if (!personaGroups.has(label)) {
        personaGroups.set(label, []);
        groupOrder.push(label);
      }
      personaGroups.get(label).push({ schemaKey, record, file, mode });
    }

    for (const label of groupOrder) {
      console.log(`\n  ${label}:`);

      const bySchema = new Map();
      for (const entry of personaGroups.get(label)) {
        if (!bySchema.has(entry.schemaKey)) bySchema.set(entry.schemaKey, { record: entry.record, files: [] });
        bySchema.get(entry.schemaKey).files.push({ file: entry.file, mode: entry.mode });
      }

      for (const { record, files } of bySchema.values()) {
        let totalRecords = 0;
        let failed = false;
        for (const { file, mode } of files) {
          const filePath = path.resolve(process.cwd(), file);
          if (!fs.existsSync(filePath)) {
            console.log(chalk.yellow("  !") + ` Sample data not found: ${file}`);
            failed = true;
            continue;
          }
          const data = loadSampleData(filePath);
          totalRecords += data.length;
          const payload = mode === "single" ? data[0] : data;
          const ok = await streamRecord(inletUrl, payload, record.dataflowId);
          if (!ok) failed = true;
          await new Promise((r) => setTimeout(r, 1000));
        }
        const countLabel = totalRecords === 1 ? "1 record" : `${totalRecords} records`;
        if (!failed) console.log(chalk.green("  ✓") + ` ${record.name} (${countLabel})`);
        else console.log(chalk.red("  ✗") + ` ${record.name} — streaming failed`);
      }
    }

    console.log("\nProfile data deployment complete.");
    console.log("Wait 15 minutes before running the health check.");
    logDone(startTime);
  } catch (err) {
    console.log(chalk.red("  ✗") + ` ${err.message}`);
  }
}
