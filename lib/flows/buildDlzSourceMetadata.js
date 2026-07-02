import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import chalk from "chalk";
import { PREFIX_STANDARD, PREFIX_RELATIONAL } from "../constants/prefix.js";
import { lookupDatasetByName } from "../datasets/lookupDatasetByName.js";

/**
 * Assembles per-dataset DLZ source metadata for `bulkCreateDataFlows`.
 *
 * Resolves each `<schema-key>:<id>` reference from `dataLoadRefs` against
 * the catalog at `fileListConfigPath` (shape: `schemas[key] = [ {id, localPath,
 * targetPath, type, dataFormat, ...} ]`). For each matched entry, resolves the
 * dataset name via the sibling `schemas.yaml` registry (applying `{PREFIX_NAME}`
 * substitution based on whether the registry lives under `relational/` or not),
 * looks up the dataset in the AEP Catalog, and returns a Map keyed by dataset
 * name with the entry's file-format fields plus `datasetId`, `schemaId`, and
 * `schemaKey`.
 *
 * @param {string} accessToken
 * @param {Object} envMap
 * @param {string} fileListConfigPath - Absolute path to data-load.yaml (the catalog).
 * @param {string[]} dataLoadRefs - List of `<schema-key>:<id>` strings from deploy.yaml.
 * @returns {Promise<Map<string, Object>>} - Map of datasetName → record.
 */
export async function buildDlzSourceMetadata(accessToken, envMap, fileListConfigPath, dataLoadRefs) {
  try {
    const fileListWrapper = yaml.load(fs.readFileSync(fileListConfigPath, "utf8"));
    const catalog = fileListWrapper.schemas || {};

    const registryPath = path.join(path.dirname(fileListConfigPath), "schemas.yaml");
    const prefixName = registryPath.includes(`${path.sep}relational${path.sep}`)
      ? PREFIX_RELATIONAL
      : PREFIX_STANDARD;
    const registry = yaml.load(fs.readFileSync(registryPath, "utf8"));
    const schemaKeyToTitle = new Map(
      registry.schemas.map((s) => [
        s.key,
        (s.name || s.title || "").replace(/\{PREFIX_NAME\}/g, prefixName),
      ])
    );

    const datasets = new Map();

    for (const raw of (dataLoadRefs || [])) {
      const [schemaKey, id] = String(raw).split(":");
      if (!schemaKey || !id) {
        console.log(chalk.red("  ✗") + ` Invalid dataLoad entry "${raw}" — expected <schema-key>:<id>`);
        return;
      }
      const entry = (catalog[schemaKey] || []).find((e) => e.id === id);
      if (!entry) {
        console.log(chalk.red("  ✗") + ` data-load.yaml has no entry "${schemaKey}:${id}"`);
        return;
      }
      const datasetName = schemaKeyToTitle.get(schemaKey);
      if (!datasetName) {
        throw new Error(`Schema key "${schemaKey}" not found in registry`);
      }
      const filePath = entry.localPath?.trim();
      if (!filePath) continue;

      const { datasetId, schemaId } = await lookupDatasetByName(
        accessToken,
        envMap,
        datasetName
      );

      datasets.set(datasetName, {
        datasetId,
        schemaId,
        schemaKey,
        localPath: entry.localPath,
        targetPath: entry.targetPath,
        type: entry.type,
        dataFormat: entry.dataFormat,
        columnDelimiter: entry.columnDelimiter,
        encoding: entry.encoding,
        compressionType: entry.compressionType,
      });
    }

    return datasets;
  } catch (err) {
    console.log(chalk.red("  ✗") + ` ${err.message}`);
    return;
  }
}
