import axios from "axios";

/**
 * Looks up a dataset in the AEP Catalog Service by exact name match.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {string} datasetName - Exact dataset name to look up.
 * @returns {Promise<{ datasetId: string, schemaId: string|null }>}
 * @throws {Error} If no dataset with that name is returned.
 */
export async function lookupDatasetByName(accessToken, envMap, datasetName) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const encodedName = encodeURIComponent(datasetName);
  const url =
    `https://platform.adobe.io/data/foundation/catalog/dataSets` +
    `?properties=name,schemaRef.id,tags&property=name%3D${encodedName}`;

  const response = await axios.get(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "x-api-key": apiKey,
      "x-gw-ims-org-id": imsOrg,
      "x-sandbox-name": sandbox,
    },
  });

  const matchingEntry = Object.entries(response.data).find(
    ([, details]) => details.name === datasetName
  );
  if (!matchingEntry) {
    throw new Error(`Dataset "${datasetName}" not found in catalog`);
  }

  const [datasetId, details] = matchingEntry;
  const enabledAtStr = (details.tags?.unifiedProfile || [])
    .find(t => t.startsWith("enabledAt:"))
    ?.slice("enabledAt:".length);
  const profileEnabledAt = enabledAtStr
    ? new Date(enabledAtStr.replace(" ", "T") + "Z").getTime()
    : null;
  return { datasetId, schemaId: details.schemaRef?.id || null, profileEnabledAt };
}
