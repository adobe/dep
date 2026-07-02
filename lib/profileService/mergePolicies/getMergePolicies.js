import axios from "axios";
import { withRetry } from "../../utils/withRetry.js";

export async function getMergePolicies(accessToken, envMap, schemaName) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
  };

  return await withRetry(async () => {
    const r = await axios.get(
      `https://platform.adobe.io/data/core/ups/config/mergePolicies?schema.name=${encodeURIComponent(schemaName)}`,
      { headers, validateStatus: () => true }
    );
    if (r.status === 200) return r.data.children || [];
    const detail = r.data?.title || r.data?.detail || `status ${r.status}`;
    throw new Error(detail);
  }, 3, 2000);
}
