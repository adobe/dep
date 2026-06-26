import axios from "axios";
import fs from "fs";
import yaml from "js-yaml";
import { withRetry } from "../utils/withRetry.js";

/**
 * Creates a dataflow with retry logic.
 * @accessToken {string} - access token developer project
 * @envMap {map} - environment file values stored in a map
 * @dataset {map} - contains all datasets and instructions from the file-list.yaml
 * @sourceConfigPath {string} - path to the source connector information
 * @returns {string|false} - The created flow ID or false if all retries failed.
 */
export async function createFlow(
  accessToken,
  envMap,
  dataset,
  sourceConfigPath
) {
  const apiKey = envMap.API_KEY;
  const imsOrg = envMap.IMS_ORG;
  const sandbox = envMap.SANDBOX_NAME;

  const sourceConfig = yaml.load(fs.readFileSync(sourceConfigPath, "utf8"));
  const payload = sourceConfig.flowConfig;

  payload.name = dataset.name;
  payload.description = `Auto-created flow for ${dataset.name}`;
  payload.sourceConnectionIds = [`${dataset.configs.sourceConnectionId}`];
  payload.targetConnectionIds = [`${dataset.configs.targetConnectionId}`];
  payload.transformations[0].params.mappingId = dataset.configs.mappingSetId;
  if (payload.scheduleParams && "startTime" in payload.scheduleParams) {
    payload.scheduleParams.startTime = Math.floor(Date.now() / 1000);
  }

  const url = "https://platform.adobe.io/data/foundation/flowservice/flows";
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
