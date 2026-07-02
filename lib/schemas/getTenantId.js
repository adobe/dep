import axios from "axios";
import { withRetry } from "../utils/withRetry.js";

/**
 * Retrieves the tenant ID for the current IMS org from the Schema Registry.
 * The tenant ID is needed to construct schema $id references in descriptors.
 *
 * It works by fetching the tenant schema list and parsing the meta:altId of
 * the first result. The altId format is "_tenantCoreId.schemas.{uuid}", so
 * splitting on "." and taking index 0 gives "_tenantCoreId".
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @returns {Promise<{tenantId: string, tenantCoreId: string}>}
 *   tenantId = "_myorg" (with underscore prefix)
 *   tenantCoreId = "myorg" (without prefix, used in schema $id URLs)
 */
export async function getTenantId(accessToken, envMap) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    Accept: "application/vnd.adobe.xed-id+json",
  };

  // Try schemas first, then classes, then mixins — handles sandboxes where schemas
  // don't exist yet but a class or field group was just created.
  const resourceTypes = ["schemas", "classes", "mixins"];

  return withRetry(async () => {
    for (const type of resourceTypes) {
      const typeUrl = `https://platform.adobe.io/data/foundation/schemaregistry/tenant/${type}`;
      try {
        const response = await axios.get(typeUrl, { headers });
        const results = response.data?.results;

        if (results && results.length > 0) {
          // meta:altId format: "_tenantCoreId.<type>.<uuid>"
          const tenantId = results[0]["meta:altId"].split(".")[0];
          const tenantCoreId = tenantId.slice(1); // strip the leading "_"
          return { tenantId, tenantCoreId };
        }
      } catch (err) {
        if (err.response?.status === 404) {
          throw new Error(`Sandbox "${sandbox}" not found (404) — check your SANDBOX_NAME`);
        }
        if (err.response?.status === 403) {
          throw new Error(`Access denied to sandbox "${sandbox}" (403) — check your credentials`);
        }
        if (err.response?.status) {
          throw new Error(`Schema Registry request failed (${err.response.status})`);
        }
        throw err;
      }
    }

    throw new Error(
      `No XDM resources found in sandbox "${sandbox}" — deploy at least one class or field group first`
    );
  });
}
