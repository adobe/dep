import axios from "axios";
import { withRetry } from "../utils/withRetry.js";

export async function listSchemas(accessToken, envMap) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    Accept: "application/vnd.adobe.xed-id+json",
  };

  return await withRetry(async () => {
    const r = await axios.get(
      "https://platform.adobe.io/data/foundation/schemaregistry/tenant/schemas?limit=100",
      { headers, validateStatus: () => true }
    );
    if (r.status === 200) return r.data.results || [];
    const detail = r.data?.title || r.data?.detail || `status ${r.status}`;
    throw new Error(detail);
  }, 3, 2000);
}
