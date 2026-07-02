import axios from "axios";
import { withRetry } from "../../utils/withRetry.js";

export async function patchMergePolicy(accessToken, envMap, mergePolicyId, patchOps) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
  };

  await withRetry(async () => {
    const r = await axios.patch(
      `https://platform.adobe.io/data/core/ups/config/mergePolicies/${mergePolicyId}`,
      patchOps,
      { headers, validateStatus: () => true }
    );
    if (r.status >= 200 && r.status < 300) return r;
    const detail = r.data?.title || r.data?.detail || `status ${r.status}`;
    throw new Error(detail);
  }, 3, 2000);

  return true;
}
