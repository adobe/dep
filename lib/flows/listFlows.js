import axios from "axios";
import { PREFIX_STANDARD, PREFIX_RELATIONAL } from "../constants/prefix.js";

/**
 * Lists all Flow Service flows in the sandbox that match the dep prefix.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {"standard"|"relational"|"all"} type - Namespace scope to match.
 * @returns {Promise<Array<{id: string, name: string, sourceConnectionIds: string[], targetConnectionIds: string[]}>>}
 */
export async function listFlows(accessToken, envMap, type) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;
  const prefixes = type === "relational"
    ? [PREFIX_RELATIONAL]
    : type === "standard"
      ? [PREFIX_STANDARD]
      : [PREFIX_STANDARD, PREFIX_RELATIONAL];

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
  };

  const response = await axios.get(
    "https://platform.adobe.io/data/foundation/flowservice/flows?limit=100",
    { headers, validateStatus: () => true }
  );

  if (response.status !== 200) {
    const detail = response.data?.title || response.data?.detail || `status ${response.status}`;
    throw new Error(`Failed to list flows: ${detail}`);
  }

  const items = response.data?.items || [];
  return items
    .filter((item) => item.name && prefixes.some((p) => item.name.startsWith(p)))
    .map((item) => ({
      id: item.id,
      name: item.name,
      state: item.state,
      sourceConnectionId: item.sourceConnectionIds[0] || [],
      targetConnectionId: item.targetConnectionIds[0] || [],
      mappingsetId: item.transformations[0].params.mappingId || []
    }));
}
