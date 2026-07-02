import fs from "fs";
import path from "path";
import chalk from "chalk";
import { createSourceConn } from "./createSourceConn.js";
import { createTargetConn } from "./createTargetConn.js";
import { createMappingSet } from "./createMappingSet.js";
import { createFlow } from "./createFlow.js";
import { cleanupRouter } from "./cleanup.js";
import { listFlows } from "./listFlows.js";

/**
 * Orchestrates the creation of source dataflows for all datasets in the source map.
 * Deletes any existing flows first, then recreates everything from scratch.
 *
 * The mapping set for each dataset is loaded from {mappingSetDir}/{schemaKey}.json,
 * where schemaKey is stored on each dataset record by the upstream source-metadata
 * assembler (buildDlzSourceMetadata.js or buildHttpSourceMetadata.js).
 *
 * @param {Object} params
 * @param {string} params.accessToken
 * @param {Object} params.envMap
 * @param {string} params.sourceConfigPath - Path to source connector YAML config.
 * @param {string} params.mappingSetDir - Path to the mapping-sets directory.
 * @param {Map} params.sourceDatasets - Source-dataset map from a build*SourceMetadata helper.
 * @param {Object} [params.options] - Optional overrides.
 * @param {"standard"|"relational"} [params.options.type="standard"] - Determines which flow configuration logic to use.
 * @param {string} [params.options.baseConnectionId] - Base connection ID to inject into each dataset's configs (HTTP API).
 */
export async function createDataFlows({
  accessToken,
  envMap,
  sourceConfigPath,
  mappingSetDir,
  sourceDatasets,
  options = {},
}) {

  if (!["standard", "relational"].includes(options.type)) {
  throw new Error(
    `createDataFlows: invalid type "${options.type}". Expected "standard" or "relational".`
  );
  }

  // Find all existing flows up front and remove them before creating new ones.
  const existingFlows = await listFlows(accessToken, envMap, options.type);

  const toCreate = new Map();

  // Queue everything for creation.
  for (const [name, record] of sourceDatasets) {
    toCreate.set(name, record);
  }

  // Collect all IDs from all existing flows so they can be deleted in one cleanup call.
  const sourceConnectionIdsToDelete = [];
  const targetConnectionIdsToDelete = [];
  const mappingsetIdsToDelete = [];
  const flowIdsToDelete = [];

  for (const flow of existingFlows ?? []) {
    const pushAll = (bucket, value) => {
      if (Array.isArray(value)) {
        bucket.push(...value.filter(Boolean));
      } else if (value) {
        bucket.push(value);
      }
    };

    pushAll(sourceConnectionIdsToDelete, flow.sourceConnectionIds ?? flow.sourceConnectionId);
    pushAll(targetConnectionIdsToDelete, flow.targetConnectionIds ?? flow.targetConnectionId);
    pushAll(mappingsetIdsToDelete, flow.mappingsetIds ?? flow.mappingsetId);

    if (flow.id) {
      flowIdsToDelete.push(flow.id);
    }
  }

  const uniqueSourceConnectionIds = [...new Set(sourceConnectionIdsToDelete)];
  const uniqueTargetConnectionIds = [...new Set(targetConnectionIdsToDelete)];
  const uniqueMappingsetIds = [...new Set(mappingsetIdsToDelete)];
  const uniqueFlowIds = [...new Set(flowIdsToDelete)];

  if (uniqueFlowIds.length > 0) {
    console.log(
      chalk.yellow("  !") +
        ` Found ${uniqueFlowIds.length} existing flow(s); deleting before creation...\n`
    );

    const cleanupSuccess = await cleanupRouter(
      accessToken,
      envMap,
      uniqueSourceConnectionIds,
      uniqueTargetConnectionIds,
      uniqueMappingsetIds,
      uniqueFlowIds
    );

    if (!cleanupSuccess) {
      console.log(
        chalk.yellow("  !") +
          " Some existing flow artifacts could not be deleted — check Flow Service"
      );
    }

    console.log(
      chalk.yellow("\n  !") +
        ` All ${uniqueFlowIds.length} existing flow(s) deleted. Creating ${toCreate.size} new flows now...`
    );
  }
  
  const total = toCreate.size;

  try {
    // Initialize connection tracking fields on each record being created.
    // Sync back into sourceDatasets so the caller can read dataflowId after creation.
    for (const [name, record] of toCreate) {
      const initialized = {
        ...record,
        ...(options.baseConnectionId && { baseConnectionId: options.baseConnectionId }),
        sourceConnectionId: null,
        targetConnectionId: null,
        mappingSetId: null,
        dataflowId: null,
      };
      toCreate.set(name, initialized);
      sourceDatasets.set(name, initialized);
    }

    // ----------------------------------------------------------------------------------
    // Step 1: Source Connections
    // ----------------------------------------------------------------------------------
    console.log("    Creating source connections...");
    const createdSourceConnections = [];
    for (const [name, configs] of toCreate) {
      const sourceConnId = await createSourceConn(
        accessToken,
        envMap,
        { name, configs },
        sourceConfigPath
      );

      if (!sourceConnId) {
        console.log(chalk.red("  ✗") + ` Source connection failed for "${name}"`);
        await runCleanup(accessToken, envMap, createdSourceConnections, [], [], []);
        return false;
      }

      const record = toCreate.get(name);
      record.sourceConnectionId = sourceConnId;
      createdSourceConnections.push(sourceConnId);
    }
    console.log(
      chalk.green("    ✓") +
        ` Source connections created (${createdSourceConnections.length}/${total})`
    );

    // ----------------------------------------------------------------------------------
    // Step 2: Target Connections
    // ----------------------------------------------------------------------------------
    console.log("    Creating target connections...");
    const createdTargetConnections = [];
    for (const [name, configs] of toCreate) {
      const targetConnId = await createTargetConn(
        accessToken,
        envMap,
        { name, configs },
        sourceConfigPath
      );

      if (!targetConnId) {
        console.log(chalk.red("  ✗") + ` Target connection failed for "${name}"`);
        await runCleanup(
          accessToken,
          envMap,
          createdSourceConnections,
          createdTargetConnections,
          [],
          []
        );
        return false;
      }

      const record = toCreate.get(name);
      record.targetConnectionId = targetConnId;
      createdTargetConnections.push(targetConnId);
    }
    console.log(
      chalk.green("    ✓") +
        ` Target connections created (${createdTargetConnections.length}/${total})`
    );

    // ----------------------------------------------------------------------------------
    // Step 3: Mapping Sets
    // ----------------------------------------------------------------------------------
    console.log("    Creating mapping sets...");

    const createdMappingSets = [];
    for (const [name, configs] of toCreate) {
      const fileName = configs.schemaKey.replace(/_/g, "-") + ".json";
      const filePath = path.join(mappingSetDir, fileName);
      const mappingSet = JSON.parse(fs.readFileSync(filePath, "utf8"));

      let mappingSetId;
      try {
        mappingSetId = await createMappingSet(
          accessToken,
          envMap,
          { name, configs },
          mappingSet
        );
      } catch (err) {
        console.log(chalk.red("    ✗") + ` Mapping set failed for "${name}"`);
        await runCleanup(
          accessToken,
          envMap,
          createdSourceConnections,
          createdTargetConnections,
          createdMappingSets,
          []
        );
        console.log(chalk.red("    ✗") + ` Error: ${err.message}`);
        return false;
      }

      if (!mappingSetId) {
        console.log(chalk.red("    ✗") + ` Mapping set failed for "${name}"`);
        await runCleanup(
          accessToken,
          envMap,
          createdSourceConnections,
          createdTargetConnections,
          createdMappingSets,
          []
        );
        return false;
      }

      const record = toCreate.get(name);
      record.mappingSetId = mappingSetId;
      createdMappingSets.push(mappingSetId);
    }
    console.log(
      chalk.green("    ✓") +
        ` Mapping sets created (${createdMappingSets.length}/${total})`
    );

    // ----------------------------------------------------------------------------------
    // Step 4: Flows
    // ----------------------------------------------------------------------------------
    console.log("    Creating flows...");
    const createdDataflows = [];
    for (const [name, configs] of toCreate) {
      const flowId = await createFlow(
        accessToken,
        envMap,
        { name, configs },
        sourceConfigPath
      );

      if (!flowId) {
        console.log(chalk.red("  ✗") + ` Dataflow failed for "${name}"`);
        await runCleanup(
          accessToken,
          envMap,
          createdSourceConnections,
          createdTargetConnections,
          createdMappingSets,
          createdDataflows
        );
        return false;
      }

      const record = toCreate.get(name);
      record.dataflowId = flowId;
      createdDataflows.push(flowId);
    }
    console.log(
      chalk.green("    ✓") +
        ` Flows created (${createdDataflows.length}/${total})`
    );
  } catch (err) {
    console.log(chalk.red("  ✗") + ` Error: ${err.message}`);
    return false;
  }

  return true;
}

async function runCleanup(accessToken, envMap, sources, targets, mappings, flows) {
  console.log("\n    Rolling back...");
  const success = await cleanupRouter(accessToken, envMap, sources, targets, mappings, flows);
  if (!success) {
    console.log(
      chalk.yellow("    !") +
        " Some artifacts could not be deleted — check Flow Service"
    );
  }
}