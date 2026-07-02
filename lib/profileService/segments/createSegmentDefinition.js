import axios from "axios";
import { withRetry } from "../../utils/withRetry.js";

export async function createSegmentDefinition(accessToken, envMap, segmentDef) {
  const { IMS_ORG: imsOrg, SANDBOX_NAME: sandbox, API_KEY: apiKey } = envMap;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
  };

  return await withRetry(async () => {
    const r = await axios.post(
      "https://platform.adobe.io/data/core/ups/segment/definitions",
      segmentDef,
      { headers, validateStatus: () => true }
    );
    if (r.status === 200 || r.status === 201) return r.data.id;
    const detail = r.data?.title || r.data?.detail || `status ${r.status}`;
    throw new Error(detail);
  }, 3, 2000);
}
