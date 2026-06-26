import axios from "axios";
import { withRetry } from "../utils/withRetry.js";
import { checkRelationalDatasetStatus } from "./checkRelationalDatasetStatus.js";

/**
 * Enables a dataset for the AJO relational store.
 * This is specific to relational XDM schemas — other schema types use different paths.
 *
 * The endpoint accepts a batch of dataset IDs per call, but this function
 * enables one at a time so the orchestrator can track failures per dataset.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {string} datasetId - The dataset ID to enable for the relational store.
 * @returns {Promise<void>}
 */
export async function enableRelationalDataset(accessToken, envMap, datasetId) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const status = await checkRelationalDatasetStatus(accessToken, envMap, datasetId);
  if (status?.enabled === true) {
    return { alreadyEnabled: true };
  }

  const url = "https://platform.adobe.io/ajo/relational/modeler/datasets/extensions/enablement";
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
  };

  const payload = { datasetIds: [datasetId] };

  try {
    await withRetry(async () => {
      const response = await axios.post(url, payload, { headers });
      if (response.status !== 200 && response.status !== 201 && response.status !== 204) {
        throw new Error(
          `Unexpected status ${response.status} enabling dataset ${datasetId} for relational store`
        );
      }
    });
  } catch (err) {
    // 400 means the dataset is already enabled — treat as idempotent success
    if (err?.response?.status === 400 || String(err.message).includes("status code 400")) {
      return { alreadyEnabled: true };
    }
    throw err;
  }

  return { alreadyEnabled: false };
}
