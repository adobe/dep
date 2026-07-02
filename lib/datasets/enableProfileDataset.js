import axios from "axios";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30_000;

/**
 * Enables a dataset for Real-time Customer Profile and Identity Service.
 * Both tags must be set together for data to flow to the profile store.
 *
 * Retries on 422 (schema union not yet propagated) up to MAX_RETRIES times
 * with a 30s delay between attempts.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {string} datasetId - The dataset ID to enable.
 * @returns {Promise<void>}
 */
export async function enableProfileDataset(accessToken, envMap, datasetId) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const url = `https://platform.adobe.io/data/foundation/catalog/dataSets/${datasetId}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json-patch+json",
  };

  const existing = await axios.get(url, { headers });
  const profileTags = existing.data?.tags?.unifiedProfile || [];
  if (profileTags.includes("enabled:true")) {
    return { alreadyEnabled: true };
  }

  const body = [
    { op: "add", path: "/tags/unifiedProfile", value: ["enabled:true", "isUpsert:true"] },
    { op: "add", path: "/tags/unifiedIdentity", value: ["enabled:true"] },
  ];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await axios.patch(url, body, { headers });
      return { alreadyEnabled: false };
    } catch (err) {
      const status = err?.response?.status;
      if (status === 422 && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }
}
