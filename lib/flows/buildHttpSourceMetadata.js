import fs from "fs";
import yaml from "js-yaml";
import chalk from "chalk";
import { PREFIX_STANDARD, PREFIX_RELATIONAL } from "../constants/prefix.js";
import { lookupDatasetByName } from "../datasets/lookupDatasetByName.js";

/**
 * Assembles per-dataset HTTP-streaming source metadata for `bulkCreateDataFlows`.
 *
 * Reads a `schemas.yaml` registry, applies `{PREFIX_NAME}` substitution
 * (relational vs standard, based on the registry path), looks up each
 * dataset by name in the AEP Catalog, and returns a Map keyed by dataset
 * name with `name`, `datasetId`, `schemaId`, and `schemaKey`.
 *
 * @param {string} accessToken
 * @param {Object} envMap
 * @param {string} registryPath - Absolute path to a schemas.yaml registry.
 * @param {string[]} datasetKeys - Schema keys to assemble (from deploy.yaml dataLoad).
 * @returns {Promise<Map<string, Object>|null>}
 */
export async function buildHttpSourceMetadata(accessToken, envMap, registryPath, datasetKeys) {
  const prefixName = registryPath.includes("/relational/") || registryPath.includes("\\relational\\")
    ? PREFIX_RELATIONAL
    : PREFIX_STANDARD;

  try {
    const registry = yaml.load(fs.readFileSync(registryPath, "utf8"));
    const schemaMap = new Map(registry.schemas.map((s) => [s.key, s]));
    const datasets = new Map();

    for (const key of datasetKeys) {
      const schemaDef = schemaMap.get(key);
      if (!schemaDef) throw new Error(`Schema key "${key}" not found in registry`);

      const datasetName = schemaDef.name.replace(/\{PREFIX_NAME\}/g, prefixName);
      const { datasetId, schemaId, profileEnabledAt } = await lookupDatasetByName(
        accessToken,
        envMap,
        datasetName
      );

      datasets.set(datasetName, {
        name: datasetName,
        datasetId,
        schemaId,
        schemaKey: key,
        profileEnabledAt,
      });
    }

    return datasets;
  } catch (err) {
    console.log(chalk.red("  ✗") + ` ${err.message}`);
    return null;
  }
}
