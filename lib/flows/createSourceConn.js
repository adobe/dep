import axios from "axios";
import fs from "fs";
import yaml from "js-yaml";
import { withRetry } from "../utils/withRetry.js";

/**
 * Creates a source connection with retry logic.
 * All per-dataset field injections are conditional — only applied when the
 * value exists in dataset.configs. This makes the function source-agnostic:
 * DLZ datasets supply data/params overrides; HTTP API datasets do not.
 */
export async function createSourceConn(
  accessToken,
  envMap,
  dataset,
  sourceConfigPath
) {
  const apiKey = envMap.API_KEY;
  const imsOrg = envMap.IMS_ORG;
  const sandbox = envMap.SANDBOX_NAME;

  const sourceConfig = yaml.load(fs.readFileSync(sourceConfigPath, "utf8"));
  const payload = sourceConfig.sourceConnConfig;

  payload.name = `Source for ${dataset.name}`;
  payload.description = `Auto-created source connection for ${dataset.name}`;

  if (payload.data && dataset.configs.dataFormat) payload.data.format = dataset.configs.dataFormat;
  if (payload.data?.properties) {
    if (dataset.configs.columnDelimiter) payload.data.properties.columnDelimiter = dataset.configs.columnDelimiter;
    if (dataset.configs.encoding) payload.data.properties.encoding = dataset.configs.encoding;
    if (!dataset.configs.compressionType) delete payload.data.properties.compressionType;
    else payload.data.properties.compressionType = dataset.configs.compressionType;
  }
  if (payload.params && dataset.configs.targetPath && "path" in payload.params)
    payload.params.path = (payload.params.path || "") + dataset.configs.targetPath;
  if (payload.params && dataset.configs.type) payload.params.type = dataset.configs.type;
  if (dataset.configs.baseConnectionId) payload.baseConnectionId = dataset.configs.baseConnectionId;

  const url = "https://platform.adobe.io/data/foundation/flowservice/sourceConnections";
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
