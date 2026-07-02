import axios from "axios";
import fs from "fs";
import yaml from "js-yaml";
import { withRetry } from "../utils/withRetry.js";

/**
 * Creates a target connection with retry logic.
 * @accessToken {string} - access token developer project
 * @envMap {map} - environment file values stored in a map
 * @dataset {map} - contains all datasets and instructions from the file-list.yaml
 * @sourceConfigPath {string} - path to the source connector information
 * @returns {string|false} - The created targetConnectionId or false if all retries failed.
 */
export async function createTargetConn(
  accessToken,
  envMap,
  dataset,
  sourceConfigPath
) {
  const apiKey = envMap.API_KEY;
  const imsOrg = envMap.IMS_ORG;
  const sandbox = envMap.SANDBOX_NAME;

  const sourceConfig = yaml.load(fs.readFileSync(sourceConfigPath, "utf8"));
  const payload = sourceConfig.targetConnConfig;

  payload.name = `Target for ${dataset.name}`;
  payload.description = `Auto-created target connection for ${dataset.name}`;
  payload.data.schema.id = dataset.configs.schemaId;
  payload.params.dataSetId = dataset.configs.datasetId;

  const url = "https://platform.adobe.io/data/foundation/flowservice/targetConnections";
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
  };

  try {
    return await withRetry(async () => {
      const response = await axios.post(url, payload, { headers });
      if (response.status === 201) return response.data.id;
      throw new Error(`Unexpected status ${response.status}`);
    }, 3, 2000);
  } catch {
    return false;
  }
}
