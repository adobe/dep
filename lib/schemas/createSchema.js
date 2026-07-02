import axios from "axios";
import { withRetry } from "../utils/withRetry.js";

/**
 * Creates an XDM schema in the tenant Schema Registry.
 * The schema body is a pre-built JSON file in industry/telecom/relational/bodies/.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {Object} schemaBody - Parsed JSON object from the schema body file.
 * @returns {Promise<{schemaId: string, altId: string}>}
 *   schemaId = full $id URL (e.g. "https://ns.adobe.com/{tenant}/schemas/{uuid}")
 *   altId    = compact form used in descriptor payloads (e.g. "_{tenant}.schemas.{uuid}")
 */
export async function createSchema(accessToken, envMap, schemaBody) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const url = "https://platform.adobe.io/data/foundation/schemaregistry/tenant/schemas";
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
    Accept: "application/vnd.adobe.xed+json; version=1",
  };

  return withRetry(async () => {
    const response = await axios.post(url, schemaBody, { headers });

    if (response.status !== 201) {
      throw new Error(`Unexpected status ${response.status} creating schema "${schemaBody.title}"`);
    }

    const schemaId = response.data["$id"];
    const altId = response.data["meta:altId"];

    if (!schemaId || !altId) {
      throw new Error(`Schema created but missing $id or meta:altId in response for "${schemaBody.title}"`);
    }

    return { schemaId, altId };
  });
}
