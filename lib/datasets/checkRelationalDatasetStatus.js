import axios from "axios";

/**
 * Fetches the Orchestrated Campaign extension status for a dataset via the Catalog API.
 *
 * @param {string} accessToken
 * @param {Object} envMap
 * @param {string} datasetId
 * @returns {Promise<{ enabled?: boolean, status: string } | null>}
 *   The adobe_journeyOptimizer extensions object, or null if never enabled.
 */
export async function checkRelationalDatasetStatus(accessToken, envMap, datasetId) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const url = `https://platform.adobe.io/data/foundation/catalog/dataSets/${datasetId}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
  };

  const response = await axios.get(url, { headers });
  const datasetObj = Object.values(response.data || {})[0];
  return datasetObj?.extensions?.adobe_journeyOptimizer ?? null;
}
