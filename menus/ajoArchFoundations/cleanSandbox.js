import path from "path";
import chalk from "chalk";
import { getAccessToken } from "../../lib/env/getAccessToken.js";
import { getValidEnvContext } from "../../lib/env/envContext.js";
import { getSelectedIndustry } from "../../lib/env/getIndustry.js";
import { inspectSchemaModel, cleanSchemaModel } from "../../lib/schemas/cleanSchemaModel.js";
import { listSegmentDefinitions } from "../../lib/profileService/segments/listSegmentDefinitions.js";
import { deleteSegmentDefinition } from "../../lib/profileService/segments/deleteSegmentDefinition.js";
import { getMergePolicies } from "../../lib/profileService/mergePolicies/getMergePolicies.js";
import { deleteMergePolicy } from "../../lib/profileService/mergePolicies/deleteMergePolicy.js";
import { listFlows } from "../../lib/flows/listFlows.js";
import { listConnections } from "../../lib/flows/listConnections.js";
import { deleteFlow, deleteTargetConnection, deleteSourceConnection } from "../../lib/flows/cleanup.js";
import { deleteMappingSet } from "../../lib/flows/deleteMappingSet.js";
import { deleteConnection } from "../../lib/flows/deleteConnection.js";
import { askConfirmGeneric } from "../../lib/prompts/continuePrompt.js";
import { PREFIX_STANDARD } from "../../lib/constants/prefix.js";

export async function cleanSandbox() {
  try {
    const context = await getValidEnvContext();
    if (!context) return;
    const { envMap } = context;

    const accessToken = await getAccessToken(envMap);
    if (!accessToken) {
      console.log(chalk.red("  ✗") + " No access token provided.");
      return;
    }

    const industry = await getSelectedIndustry();
    const deployYamlPath = path.resolve(
      process.cwd(),
      "industry",
      industry,
      "lab-packs",
      "ajo-foundations",
      "deploy.yaml"
    );

    const prefix = PREFIX_STANDARD;

    console.log("\n  Scanning sandbox...\n");

    const [depFlows, depConnections, allSegments, allPolicies, inspection] = await Promise.all([
      listFlows(accessToken, envMap, "all"),
      listConnections(accessToken, envMap),
      listSegmentDefinitions(accessToken, envMap),
      getMergePolicies(accessToken, envMap, "_xdm.context.profile"),
      inspectSchemaModel(deployYamlPath, envMap, accessToken),
    ]);

    const depSegments = allSegments.filter((s) => s.name && s.name.startsWith(prefix));
    const depPolicies = allPolicies.filter((p) => !p.default && p.name && p.name.startsWith(prefix));

    const toRemoveRows = [];

    if (depSegments.length > 0) toRemoveRows.push(["Audiences", depSegments.length]);
    if (depPolicies.length > 0) toRemoveRows.push(["Merge policies", depPolicies.length]);
    if (depFlows.length > 0) toRemoveRows.push(["Dataflows", depFlows.length]);
    if (depConnections.length > 0) toRemoveRows.push(["Source accounts", depConnections.length]);

    if (inspection.toRemove.datasets > 0) toRemoveRows.push(["Datasets", inspection.toRemove.datasets]);
    if (inspection.toRemove.descriptors > 0) toRemoveRows.push(["Descriptors", inspection.toRemove.descriptors]);
    if (inspection.toRemove.schemas > 0) toRemoveRows.push(["Schemas", inspection.toRemove.schemas]);
    if (inspection.toRemove.fieldGroups > 0) toRemoveRows.push(["Field groups", inspection.toRemove.fieldGroups]);
    if (inspection.toRemove.classes > 0) toRemoveRows.push(["Classes", inspection.toRemove.classes]);

    if (toRemoveRows.length > 0) {
      console.log("  To remove:");
      const labelWidth = Math.max(...toRemoveRows.map(([label]) => label.length));
      for (const [label, count] of toRemoveRows) {
        console.log(`    ${label.padEnd(labelWidth)}  ${count}`);
      }
      console.log();
    }

    if (inspection.locked.length > 0) {
      console.log("  Cannot be removed:");
      const titleWidth = Math.max(...inspection.locked.map((i) => i.title.length));
      for (const item of inspection.locked) {
        console.log(
          `    ${chalk.yellow("⚠")}  ${item.title.padEnd(titleWidth)}  ${chalk.yellow(`(${item.reason})`)}`
        );
      }
      console.log();
    }

    if (toRemoveRows.length === 0) {
      console.log("  Nothing found to clean in this sandbox.\n");
      return;
    }

    if (depSegments.length > 0) {
      console.log(chalk.yellow("  Note:") + " Identity namespaces require a sandbox reset to remove.");
    }
    if (depPolicies.length > 0) {
      console.log(chalk.yellow("  Note:") + " Default merge policy isActiveOnEdge can be disabled manually.");
    }
    if (depSegments.length > 0 || depPolicies.length > 0) {
      console.log();
    }

    const confirmed = await askConfirmGeneric(`Proceed with cleanup on sandbox "${inspection.sandbox}"?`);
    if (!confirmed) {
      console.log("  Cancelled.\n");
      return;
    }

    console.log();

    let deletedSegCount = 0;
    for (const seg of depSegments) {
      try {
        await deleteSegmentDefinition(accessToken, envMap, seg.id);
        deletedSegCount++;
      } catch (err) {
        console.log(chalk.red("  ✗") + `  Failed to delete audience "${seg.name}": ${err.message}`);
      }
    }
    if (depSegments.length > 0) {
      const allOk = deletedSegCount === depSegments.length;
      console.log(
        (allOk ? chalk.green("  ✓") : chalk.yellow("  !")) +
          `  Audiences (${deletedSegCount}/${depSegments.length})`
      );
    }

    let deletedPolCount = 0;
    for (const pol of depPolicies) {
      try {
        await deleteMergePolicy(accessToken, envMap, pol.id);
        deletedPolCount++;
      } catch (err) {
        console.log(chalk.red("  ✗") + `  Failed to delete merge policy "${pol.name}": ${err.message}`);
      }
    }
    if (depPolicies.length > 0) {
      const allOk = deletedPolCount === depPolicies.length;
      console.log(
        (allOk ? chalk.green("  ✓") : chalk.yellow("  !")) +
          `  Merge policies (${deletedPolCount}/${depPolicies.length})`
      );
    }

    const flowErrors = [];
    const connErrors = [];

    let deletedFlowCount = 0;
    for (const flow of depFlows) {
      try {
        const flowDeleted = await deleteFlow(flow.id, accessToken, envMap);
        if (!flowDeleted) {
          flowErrors.push(`Failed to delete flow "${flow.name}"`);
          continue;
        }

        let cleanupOk = true;

        if (flow.mappingsetId) {
          try {
            await deleteMappingSet(accessToken, envMap, flow.mappingsetId);
          } catch (err) {
            cleanupOk = false;
            flowErrors.push(`Failed to delete mapping set for flow "${flow.name}": ${err.message}`);
          }
        }

        if (flow.targetConnectionId) {
          try {
            const ok = await deleteTargetConnection(flow.targetConnectionId, accessToken, envMap);
            if (!ok) cleanupOk = false;
          } catch (err) {
            cleanupOk = false;
            flowErrors.push(`Failed to delete target connection for flow "${flow.name}": ${err.message}`);
          }
        }

        if (flow.sourceConnectionId) {
          try {
            const ok = await deleteSourceConnection(flow.sourceConnectionId, accessToken, envMap);
            if (!ok) cleanupOk = false;
          } catch (err) {
            cleanupOk = false;
            flowErrors.push(`Failed to delete source connection for flow "${flow.name}": ${err.message}`);
          }
        }

        deletedFlowCount++;
        if (!cleanupOk) {
          flowErrors.push(`"${flow.name}" — flow removed but some connections or mapping set may remain`);
        }
      } catch (err) {
        flowErrors.push(`Failed to delete flow "${flow.name}": ${err.message}`);
      }
    }

    if (depFlows.length > 0) {
      const allOk = deletedFlowCount === depFlows.length;
      console.log(
        (allOk ? chalk.green("  ✓") : chalk.yellow("  !")) +
          `  Dataflows (${deletedFlowCount}/${depFlows.length})`
      );
      for (const msg of flowErrors) console.log(chalk.red("    ✗") + `  ${msg}`);
      await new Promise((r) => setTimeout(r, 10_000));
    }

    let deletedConnCount = 0;
    for (const conn of depConnections) {
      try {
        await deleteConnection(accessToken, envMap, conn.id);
        deletedConnCount++;
      } catch (err) {
        connErrors.push(`Failed to delete source account "${conn.name}": ${err.message}`);
      }
    }
    if (depConnections.length > 0) {
      const allOk = deletedConnCount === depConnections.length;
      console.log(
        (allOk ? chalk.green("  ✓") : chalk.yellow("  !")) +
          `  Source accounts (${deletedConnCount}/${depConnections.length})`
      );
      for (const msg of connErrors) console.log(chalk.red("    ✗") + `  ${msg}`);
    }

    const { stillPresent } = await cleanSchemaModel(inspection, envMap, accessToken);
    if (stillPresent.length === 0) {
      console.log(chalk.green("\n  ✓") + "  All artifacts verified removed.\n");
    } else {
      console.log(
        chalk.yellow("\n  !") +
          `  ${stillPresent.length} artifact(s) still present after deletion — re-run cleanup to retry:`
      );
      for (const title of stillPresent) {
        console.log(chalk.yellow("    ⚠") + `  ${title}`);
      }
      console.log();
    }
  } catch (err) {
    console.log(chalk.red("  ✗") + `  ${err.message}`);
  }
}