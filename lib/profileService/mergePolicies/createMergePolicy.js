import axios from "axios";
import { withRetry } from "../../utils/withRetry.js";

export async function createMergePolicy(accessToken, envMap, policy) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
  };

  const payload = {
    name: policy.name,
    identityGraph: { type: policy.identityGraph },
    attributeMerge: { type: policy.attributeMerge },
    schema: { name: "_xdm.context.profile" },
    isActiveOnEdge: policy.isActiveOnEdge ?? false,
    default: false,
  };

  return await withRetry(async () => {
    const r = await axios.post(
      "https://platform.adobe.io/data/core/ups/config/mergePolicies",
      payload,
      { headers, validateStatus: () => true }
    );
    if (r.status === 200 || r.status === 201) return r.data.id;
    const detail = r.data?.title || r.data?.detail || `status ${r.status}`;
    throw new Error(detail);
  }, 3, 2000);
}
