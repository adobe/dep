import axios from "axios";
import { withRetry } from "../../utils/withRetry.js";

/**
 * Deletes a descriptor by its @id. Used during rollback only.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {string} descriptorId - The "@id" value returned when the descriptor was created.
 * @returns {Promise<void>}
 */
export async function deleteDescriptor(accessToken, envMap, descriptorId) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  // @id may be a bare hash or a full URL depending on which API returned it.
  // Construct the full URL when it's a hash.
  const url = descriptorId.startsWith("http")
    ? descriptorId
    : `https://platform.adobe.io/data/foundation/schemaregistry/tenant/descriptors/${descriptorId}`;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
  };

  return withRetry(async () => {
    const response = await axios.delete(url, { headers });

    if (response.status !== 204) {
      throw new Error(`Unexpected status ${response.status} deleting descriptor ${descriptorId}`);
    }
  });
}
