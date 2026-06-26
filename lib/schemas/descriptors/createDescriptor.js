import axios from "axios";
import { withRetry } from "../../utils/withRetry.js";

/**
 * Creates a single XDM descriptor in the Schema Registry.
 * The orchestrator (schemas/deploySchemaModel.js) resolves all schema keys to $ids
 * and constructs the full payload before calling this function.
 *
 * Descriptor payload shapes (orchestrator builds these):
 *
 * Primary key:
 *   { "@type": "xdm:descriptorPrimaryKey",
 *     "xdm:sourceSchema": "<schemaId>",
 *     "xdm:sourceProperty": ["/<fieldName>"],   // array
 *     "xdm:sourceVersion": 1 }
 *
 * Foreign key (relationship):
 *   { "@type": "xdm:descriptorRelationship",
 *     "xdm:sourceSchema": "<schemaId>",
 *     "xdm:sourceProperty": ["/<fieldName>"],   // array
 *     "xdm:sourceVersion": 1,
 *     "xdm:destinationSchema": "<schemaId>",
 *     "xdm:destinationProperty": ["/<fieldName>"],
 *     "xdm:destinationVersion": 1,
 *     "xdm:cardinality": "M:1",
 *     "xdm:sourceToDestinationTitle": "...",
 *     "xdm:destinationToSourceTitle": "..." }
 *
 * Version field:
 *   { "@type": "xdm:descriptorVersion",
 *     "xdm:sourceSchema": "<schemaId>",
 *     "xdm:sourceProperty": "/<fieldName>",     // string, not array
 *     "xdm:sourceVersion": 1 }
 *
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME).
 * @param {Object} descriptorPayload - Fully resolved descriptor body (see shapes above).
 * @returns {Promise<string>} - The descriptor "@id" string returned by the API.
 */
export async function createDescriptor(accessToken, envMap, descriptorPayload) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const url = "https://platform.adobe.io/data/foundation/schemaregistry/tenant/descriptors";
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
    "Content-Type": "application/json",
    Accept: "application/vnd.adobe.xed+json; version=1",
  };

  return withRetry(async () => {
    const response = await axios.post(url, descriptorPayload, { headers });

    if (response.status !== 201) {
      throw new Error(
        `Unexpected status ${response.status} creating descriptor of type "${descriptorPayload["@type"]}"`
      );
    }

    const descriptorId = response.data["@id"];
    if (!descriptorId) {
      throw new Error(`Descriptor created but missing @id in response`);
    }

    return descriptorId;
  });
}
