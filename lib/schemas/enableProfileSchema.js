import axios from "axios";
import { withRetry } from "../utils/withRetry.js";

/**
 * Enables a schema for Real-time Customer Profile by adding the "union" immutable tag.
 * This is a JSON Patch PATCH request — the schema must already exist.
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {string} altId - The meta:altId of the schema to enable.
 * @returns {Promise<void>}
 */
export async function enableProfileSchema(accessToken, envMap, altId) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const encodedAltId = encodeURIComponent(altId);
  const url = `https://platform.adobe.io/data/foundation/schemaregistry/tenant/schemas/${encodedAltId}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
    Accept: "application/vnd.adobe.xed+json; version=1",
  };

  const existing = await axios.get(url, { headers });
  const tags = existing.data?.["meta:immutableTags"];
  if (Array.isArray(tags) && tags.includes("union")) {
    return { alreadyEnabled: true };
  }

  const payload = [{ op: "add", path: "/meta:immutableTags", value: ["union"] }];

  await withRetry(async () => {
    const response = await axios.patch(url, payload, { headers });
    if (response.status !== 200) {
      throw new Error(`Unexpected status ${response.status} enabling profile for schema ${altId}`);
    }
  });

  return { alreadyEnabled: false };
}
