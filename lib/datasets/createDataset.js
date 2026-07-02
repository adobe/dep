import axios from "axios";
import { withRetry } from "../utils/withRetry.js";

/**
 * Creates a dataset in the AEP Catalog Service for a given schema.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {string} datasetName - Display name for the dataset (typically the schema title).
 * @param {string} schemaId - Full $id URL of the schema to associate with this dataset.
 * @returns {Promise<string>} - The created dataset ID (e.g. "6123abc...").
 */
export async function createDataset(accessToken, envMap, datasetName, schemaId) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const url = "https://platform.adobe.io/data/foundation/catalog/dataSets";
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const payload = {
    name: datasetName,
    description: datasetName,
    schemaRef: {
      id: schemaId,
      contentType: "application/vnd.adobe.xed+json;version=1",
    },
    fileDescription: {
      format: "parquet",
    },
    enableErrorDiagnostics: true,
  };

  return withRetry(async () => {
    const response = await axios.post(url, payload, { headers });

    if (response.status !== 201) {
      throw new Error(`Unexpected status ${response.status} creating dataset "${datasetName}"`);
    }

    // Response is an array like ["@/dataSets/{id}"] — strip the "@/dataSets/" prefix
    const rawId = response.data[0];
    if (!rawId) {
      throw new Error(`Dataset created but response array was empty for "${datasetName}"`);
    }

    return rawId.replace("@/dataSets/", "");
  });
}
