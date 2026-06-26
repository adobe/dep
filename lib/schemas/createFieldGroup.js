import axios from "axios";
import { withRetry } from "../utils/withRetry.js";

/**
 * Creates a custom XDM field group (mixin) in the tenant Schema Registry.
 *
 * The field group body is read from a JSON file that may contain placeholders:
 *   {tenantId}             → replaced by the caller before passing the body
 *   {CLASS_<key>}          → replaced by the caller before passing the body
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {Object} fieldGroupBody - Parsed JSON object for the field group definition,
 *   with all placeholders already substituted.
 * @returns {Promise<{fieldGroupId: string, altId: string}>}
 *   fieldGroupId = full $id URL used as $ref in schema allOf arrays
 *   altId        = compact form used for deletion (e.g. "_{tenant}.mixins.{uuid}")
 */
export async function createFieldGroup(accessToken, envMap, fieldGroupBody) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const url = "https://platform.adobe.io/data/foundation/schemaregistry/tenant/mixins";
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
    Accept: "application/vnd.adobe.xed+json; version=1",
  };

  return withRetry(async () => {
    const response = await axios.post(url, fieldGroupBody, { headers });

    if (response.status !== 201) {
      throw new Error(
        `Unexpected status ${response.status} creating field group "${fieldGroupBody.title}"`
      );
    }

    const fieldGroupId = response.data["$id"];
    const altId = response.data["meta:altId"];

    if (!fieldGroupId || !altId) {
      throw new Error(
        `Field group created but missing $id or meta:altId in response for "${fieldGroupBody.title}"`
      );
    }

    return { fieldGroupId, altId };
  });
}
