import axios from "axios";
import { withRetry } from "../utils/withRetry.js";

/**
 * Creates a custom XDM class in the tenant Schema Registry.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {Object} classBody - Parsed JSON object for the class definition.
 * @returns {Promise<{classId: string, altId: string}>}
 *   classId = full $id URL used as $ref in schema allOf and field group meta:intendedToExtend
 *   altId   = compact form used for deletion (e.g. "_{tenant}.classes.{uuid}")
 */
export async function createClass(accessToken, envMap, classBody) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const url = "https://platform.adobe.io/data/foundation/schemaregistry/tenant/classes";
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
    Accept: "application/vnd.adobe.xed+json; version=1",
  };

  return withRetry(async () => {
    const response = await axios.post(url, classBody, { headers });

    if (response.status !== 201) {
      throw new Error(`Unexpected status ${response.status} creating class "${classBody.title}"`);
    }

    const classId = response.data["$id"];
    const altId = response.data["meta:altId"];

    if (!classId || !altId) {
      throw new Error(`Class created but missing $id or meta:altId in response for "${classBody.title}"`);
    }

    return { classId, altId };
  });
}
