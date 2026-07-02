import axios from "axios";
import { withRetry } from "../utils/withRetry.js";

/**
 * Deletes a tenant class by its altId. Used during rollback only.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {string} altId - The meta:altId of the class to delete.
 * @returns {Promise<void>}
 */
export async function deleteClass(accessToken, envMap, altId) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const encodedAltId = encodeURIComponent(altId);
  const url = `https://platform.adobe.io/data/foundation/schemaregistry/tenant/classes/${encodedAltId}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
  };

  return withRetry(async () => {
    const response = await axios.delete(url, { headers });

    if (response.status !== 204) {
      throw new Error(`Unexpected status ${response.status} deleting class ${altId}`);
    }
  });
}
