import axios from "axios";
import { withRetry } from "../utils/withRetry.js";

/**
 * Deletes a tenant schema by its altId. Used during rollback only.
 *
 * The altId must be URL-encoded before use in the path because it contains
 * dots and underscores that can confuse the routing layer.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {string} altId - The meta:altId of the schema to delete (e.g. "_{tenant}.schemas.{uuid}").
 * @returns {Promise<void>}
 */
export async function deleteSchema(accessToken, envMap, altId) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const encodedAltId = encodeURIComponent(altId);
  const url = `https://platform.adobe.io/data/foundation/schemaregistry/tenant/schemas/${encodedAltId}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
  };

  return withRetry(async () => {
    const response = await axios.delete(url, { headers });

    // 204 No Content is the expected success response for DELETE
    if (response.status !== 204) {
      throw new Error(`Unexpected status ${response.status} deleting schema ${altId}`);
    }
  });
}
