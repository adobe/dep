import axios from "axios";
import { withRetry } from "../utils/withRetry.js";

/**
 * Creates a custom identity namespace in the Adobe Identity Service.
 * Treats a 409 Conflict response as success — the namespace already exists
 * and can be used as-is. Identity namespaces are never rolled back.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {Object} namespaceDef - Namespace definition from the action YAML.
 *   @param {string} namespaceDef.name - Display name of the namespace.
 *   @param {string} namespaceDef.code - Short code used to reference the namespace.
 *   @param {string} namespaceDef.idType - Identity type, e.g. "CROSS_DEVICE".
 * @returns {Promise<{id?: number, code: string}>} - The created or existing namespace.
 */
export async function createNamespace(accessToken, envMap, namespaceDef) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const url = "https://platform.adobe.io/data/core/idnamespace/identities";
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const payload = {
    name: namespaceDef.name,
    code: namespaceDef.code,
    idType: namespaceDef.idType,
    description: `dep: ${namespaceDef.name}`,
  };

  return withRetry(async () => {
    try {
      const response = await axios.post(url, payload, { headers });
      // 201: created successfully
      return { id: response.data.id, code: namespaceDef.code };
    } catch (err) {
      // 409 means the namespace already exists — treat as success
      if (err.response?.status === 409) {
        return { code: namespaceDef.code, alreadyExisted: true };
      }
      throw new Error(
        `createNamespace failed (${err.response?.status}): ${
          JSON.stringify(err.response?.data) || err.message
        }`
      );
    }
  });
}
