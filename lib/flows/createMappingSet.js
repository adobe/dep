import axios from "axios";
import { withRetry } from "../utils/withRetry.js";
import { getTenantId } from "../schemas/getTenantId.js";

/**
 * Creates a mapping set with retry logic.
 * Substitutes {tenantId} placeholders in destination paths before posting.
 */
export async function createMappingSet(
  accessToken,
  envMap,
  dataset,
  mappingSet
) {
  const apiKey = envMap.API_KEY;
  const imsOrg = envMap.IMS_ORG;
  const sandbox = envMap.SANDBOX_NAME;

  const { tenantId } = await getTenantId(accessToken, envMap);
  const resolvedMappings = JSON.parse(
    JSON.stringify(mappingSet).replace(/\{tenantId\}/g, tenantId)
  );

  const payload = {
    mappings: resolvedMappings.mappings,
    outputSchema: {
      schemaRef: {
        id: dataset.configs.schemaId,
        contentType: "application/vnd.adobe.xed-full+json;version=1",
      },
    },
  };

  const url = "https://platform.adobe.io/data/foundation/conversion/mappingSets";
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
  };

  try {
    return await withRetry(async () => {
      const response = await axios.post(url, payload, { headers, validateStatus: () => true });
      if (response.status === 200) return response.data.id;
      const detail = response.data?.title || response.data?.detail || `status ${response.status}`;
      throw new Error(detail);
    }, 3, 2000);
  } catch (err) {
    const msg = err.message.replace(/^Failed after \d+ attempt\(s\): /, "");
    throw new Error(msg);
  }
}
