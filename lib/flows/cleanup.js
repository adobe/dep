import axios from "axios";
import chalk from "chalk";
import { withRetry } from "../utils/withRetry.js";
import { deleteMappingSet } from "./deleteMappingSet.js";

// Deletes flow service artifacts created before a failure.
// Called by bulkCreateDataFlows.js when any step fails mid-run.
export async function cleanupRouter(
  accessToken,
  envMap,
  sources,
  targets,
  mappings,
  flows
) {
  let allSucceeded = true;

  // Deletion order: flows → target connections → source connections → mapping sets

  if (flows.length > 0) {
    console.log("    Deleting flows...");
    let count = 0;
    for (const id of flows) {
      if (await deleteFlow(id, accessToken, envMap)) count++;
      else allSucceeded = false;
    }
    console.log(chalk.green("    ✓") + ` Flows deleted (${count}/${flows.length})`);
    await new Promise((r) => setTimeout(r, 5_000));
  }

  if (targets.length > 0) {
    console.log("    Deleting target connections...");
    let count = 0;
    for (const id of targets) {
      if (await deleteTargetConnection(id, accessToken, envMap)) count++;
      else allSucceeded = false;
    }
    console.log(chalk.green("    ✓") + ` Target connections deleted (${count}/${targets.length})`);
  }

  if (sources.length > 0) {
    console.log("    Deleting source connections...");
    let count = 0;
    for (const id of sources) {
      if (await deleteSourceConnection(id, accessToken, envMap)) count++;
      else allSucceeded = false;
    }
    console.log(chalk.green("    ✓") + ` Source connections deleted (${count}/${sources.length})`);
  }

  if (mappings.length > 0) {
    console.log("    Deleting mapping sets...");
    let count = 0;
    for (const id of mappings) {
      try {
        await deleteMappingSet(accessToken, envMap, id);
        count++;
      } catch {
        allSucceeded = false;
      }
    }
    console.log(chalk.green("    ✓") + ` Mapping sets deleted (${count}/${mappings.length})`);
  }

  return allSucceeded;
}

export async function deleteSourceConnection(id, accessToken, envMap) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;
  const url = `https://platform.adobe.io/data/foundation/flowservice/sourceConnections/${id}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
  };

  try {
    return await withRetry(async () => {
      const response = await axios.delete(url, { headers, validateStatus: () => true });
      // 404 = already deleted; 400 = platform deactivated after parent flow removal — both acceptable
      if (response.status === 204 || response.status === 404 || response.status === 400) return true;
      const detail = response.data?.title || response.data?.detail || `status ${response.status}`;
      throw new Error(detail);
    });
  } catch {
    return false;
  }
}

export async function deleteTargetConnection(id, accessToken, envMap) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;
  const url = `https://platform.adobe.io/data/foundation/flowservice/targetConnections/${id}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
  };

  try {
    return await withRetry(async () => {
      const response = await axios.delete(url, { headers, validateStatus: () => true });
      // 404 = already deleted by platform; 400 = platform has already deactivated this
      // connection after the parent flow was removed — both are acceptable outcomes.
      if (response.status === 204 || response.status === 404 || response.status === 400) return true;
      const detail = response.data?.title || response.data?.detail || `status ${response.status}`;
      throw new Error(detail);
    });
  } catch {
    return false;
  }
}

export async function deleteFlow(id, accessToken, envMap) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;
  const url = `https://platform.adobe.io/data/foundation/flowservice/flows/${id}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
  };

  try {
    return await withRetry(async () => {
      const response = await axios.delete(url, { headers, validateStatus: () => true });
      if (response.status === 200 || response.status === 202) return true;
      const detail = response.data?.title || response.data?.detail || `status ${response.status}`;
      throw new Error(detail);
    });
  } catch {
    return false;
  }
}
