import axios from "axios";
import { PREFIX_STANDARD } from "../constants/prefix.js";

/**
 * Lists all Flow Service base connections in the sandbox that match the dep prefix.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listConnections(accessToken, envMap) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;
  const prefix = PREFIX_STANDARD;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
  };

  const response = await axios.get(
    "https://platform.adobe.io/data/foundation/flowservice/connections?limit=100",
    { headers, validateStatus: () => true }
  );

  if (response.status !== 200) {
    const detail = response.data?.title || response.data?.detail || `status ${response.status}`;
    throw new Error(`Failed to list connections: ${detail}`);
  }

  const items = response.data?.items || [];
  return items
    .filter((item) => item.name && item.name.startsWith(prefix))
    .map((item) => ({
      id: item.id,
      name: item.name,
    }));
}
