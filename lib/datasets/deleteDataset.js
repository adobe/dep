import axios from "axios";
import { withRetry } from "../utils/withRetry.js";

/**
 * Deletes a dataset by ID. Used during rollback only.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {string} datasetId - The dataset ID to delete.
 * @returns {Promise<void>}
 */
export async function deleteDataset(accessToken, envMap, datasetId) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const url = `https://platform.adobe.io/data/foundation/catalog/dataSets/${datasetId}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
  };

  return withRetry(async () => {
    const response = await axios.delete(url, { headers });

    if (response.status !== 200) {
      throw new Error(`Unexpected status ${response.status} deleting dataset ${datasetId}`);
    }
  });
}
