import axios from "axios";
import { withRetry } from "../utils/withRetry.js";

/**
 * Deletes a Flow Service base connection by ID.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {string} id - The base connection ID to delete.
 * @returns {Promise<true>} Resolves to true on success.
 */
export async function deleteConnection(accessToken, envMap, id) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const url = `https://platform.adobe.io/data/foundation/flowservice/connections/${id}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
  };

  return withRetry(async () => {
    const response = await axios.delete(url, { headers, validateStatus: () => true });

    if (response.status === 200 || response.status === 204) return true;
    const detail = response.data?.title || response.data?.detail || `status ${response.status}`;
    throw new Error(`Failed to delete connection ${id}: ${detail}`);
  }, 3, 2000);
}
