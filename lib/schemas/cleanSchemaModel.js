import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import axios from "axios";
import chalk from "chalk";
import { deleteSchema } from "./deleteSchema.js";
import { deleteFieldGroup } from "./deleteFieldGroup.js";
import { deleteClass } from "./deleteClass.js";
import { deleteDescriptor } from "./descriptors/deleteDescriptor.js";
import { deleteDataset } from "../datasets/deleteDataset.js";
import { PREFIX_STANDARD, PREFIX_RELATIONAL } from "../constants/prefix.js";

async function listResource(type, headers) {
  const url = `https://platform.adobe.io/data/foundation/schemaregistry/tenant/${type}?limit=100`;
  const response = await axios.get(url, {
    headers: { ...headers, Accept: "application/vnd.adobe.xed-id+json" },
  });
  return response.data?.results || [];
}

async function listDatasets(headers) {
  const url = "https://platform.adobe.io/data/foundation/catalog/dataSets?limit=100";
  const response = await axios.get(url, { headers });
  return Object.entries(response.data || {}).map(([id, ds]) => ({ id, name: ds.name }));
}

async function listDescriptors(headers) {
  const url = `https://platform.adobe.io/data/foundation/schemaregistry/tenant/descriptors?limit=100`;
  const response = await axios.get(url, {
    headers: { ...headers, Accept: "application/vnd.adobe.xdm+json" },
  });
  return Object.values(response.data || {}).flat().filter((d) => d && typeof d === "object");
}

async function getSchemaDetail(altId, headers) {
  const url = `https://platform.adobe.io/data/foundation/schemaregistry/tenant/schemas/${encodeURIComponent(altId)}`;
  const response = await axios.get(url, {
    headers: { ...headers, Accept: "application/vnd.adobe.xed+json; version=1" },
  });
  return response.data;
}

/**
 * Inspects the sandbox for artifacts matching the given pack manifest.
 * Reads the deploy.yaml and derives catalog paths from it; handles both
 * standard and relational sections automatically.
 * Returns a structured result describing what can be removed and what is locked.
 * Does not delete anything — pass the result to cleanSchemaModel to execute.
 *
 * @param {string} deployYamlPath - Absolute path to the pack manifest deploy.yaml.
 * @param {Object} envMap
 * @param {string} accessToken
 * @returns {Promise<Object>} inspection result
 */
export async function inspectSchemaModel(deployYamlPath, envMap, accessToken) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
  };

  const resolveName = (name, isRelational) =>
    name.replace(/\{PREFIX_NAME\}/g, isRelational ? PREFIX_RELATIONAL : PREFIX_STANDARD);
  const XDM_INDIVIDUAL_PROFILE_CLASS = "https://ns.adobe.com/xdm/context/profile";

  const deployYaml = yaml.load(fs.readFileSync(deployYamlPath, "utf8"));
  const packDir = path.dirname(deployYamlPath);

  // Build sections from each present deploy.yaml section (standard and/or relational)
  const sections = [];

  if (deployYaml.standard?.schemas?.length > 0) {
    const registryPath = path.resolve(packDir, "..", "..", "standard", "schemas.yaml");
    const registry = yaml.load(fs.readFileSync(registryPath, "utf8"));
    const selectedSchemaKeys = new Set(deployYaml.standard.schemas);
    const expectedSchemaDefs = (registry.schemas || []).filter((s) => selectedSchemaKeys.has(s.key));

    const derivedFGKeys = new Set();
    for (const schemaDef of expectedSchemaDefs) {
      for (const fgKey of schemaDef.fieldGroups?.custom || []) derivedFGKeys.add(fgKey);
    }
    const expectedFGDefs = (registry.fieldGroups || []).filter((fg) => derivedFGKeys.has(fg.key));

    const derivedClassKeys = new Set();
    for (const schemaDef of expectedSchemaDefs) {
      if (schemaDef.class && !schemaDef.class.includes("://")) derivedClassKeys.add(schemaDef.class);
    }
    for (const fgDef of expectedFGDefs) {
      if (fgDef.intendedToExtend && !fgDef.intendedToExtend.includes("://")) {
        derivedClassKeys.add(fgDef.intendedToExtend);
      }
    }
    const expectedClassDefs = (registry.classes || []).filter((c) => derivedClassKeys.has(c.key));

    sections.push({ isRelational: false, registry, expectedSchemaDefs, expectedFGDefs, expectedClassDefs });
  }

  if (deployYaml.relational?.schemas?.length > 0) {
    const registryPath = path.resolve(packDir, "..", "..", "relational", "schemas.yaml");
    const registry = yaml.load(fs.readFileSync(registryPath, "utf8"));
    const selectedSchemaKeys = new Set(deployYaml.relational.schemas);
    const expectedSchemaDefs = (registry.schemas || []).filter((s) => selectedSchemaKeys.has(s.key));
    sections.push({ isRelational: true, registry, expectedSchemaDefs, expectedFGDefs: [], expectedClassDefs: [] });
  }

  const hasArtifacts = sections.some((s) => s.expectedSchemaDefs.length > 0);
  const [allSchemas, allFGs, allClasses, allDatasets] = await Promise.all([
    listResource("schemas", headers),
    listResource("mixins", headers),
    listResource("classes", headers),
    hasArtifacts ? listDatasets(headers) : Promise.resolve([]),
  ]);

  const schemasByTitle = new Map(allSchemas.map((s) => [s.title, s]));
  const fgsByTitle = new Map(allFGs.map((fg) => [fg.title, fg]));
  const classesByTitle = new Map(allClasses.map((c) => [c.title, c]));
  const datasetsByName = new Map(allDatasets.map((d) => [d.name, d]));

  const processedSections = await Promise.all(
    sections.map(async (section) => {
      const sectionTag = section.isRelational ? "relational" : "standard";

      const foundSchemas = section.expectedSchemaDefs
        .filter((s) => schemasByTitle.has(resolveName(s.name, section.isRelational)))
        .map((s) => ({
          ...s,
          title: resolveName(s.name, section.isRelational),
          altId: schemasByTitle.get(resolveName(s.name, section.isRelational))["meta:altId"],
          schemaId: schemasByTitle.get(resolveName(s.name, section.isRelational))["$id"],
          section: sectionTag,
        }));

      const foundFGs = section.expectedFGDefs
        .filter((fg) => fgsByTitle.has(resolveName(fg.name, section.isRelational)))
        .map((fg) => ({
          ...fg,
          title: resolveName(fg.name, section.isRelational),
          altId: fgsByTitle.get(resolveName(fg.name, section.isRelational))["meta:altId"],
          section: sectionTag,
        }));

      const foundClasses = section.expectedClassDefs
        .filter((c) => classesByTitle.has(resolveName(c.name, section.isRelational)))
        .map((c) => ({
          ...c,
          title: resolveName(c.name, section.isRelational),
          altId: classesByTitle.get(resolveName(c.name, section.isRelational))["meta:altId"],
          section: sectionTag,
        }));

      let schemasWithStatus;
      if (section.isRelational || foundSchemas.length === 0) {
        schemasWithStatus = foundSchemas.map((s) => ({ ...s, profileEnabled: false, section: sectionTag }));
      } else {
        schemasWithStatus = await Promise.all(
          foundSchemas.map(async (s) => {
            try {
              const detail = await getSchemaDetail(s.altId, headers);
              const hasUnionTag =
                Array.isArray(detail["meta:immutableTags"]) &&
                detail["meta:immutableTags"].includes("union");
              const isProfileClass = detail["meta:class"] === XDM_INDIVIDUAL_PROFILE_CLASS;
              return { ...s, profileEnabled: hasUnionTag && isProfileClass, section: sectionTag };
            } catch {
              return { ...s, profileEnabled: false, section: sectionTag };
            }
          })
        );
      }

      const blockedFGKeys = new Set();
      const blockedClassKeys = new Set();
      for (const schema of schemasWithStatus.filter((s) => s.profileEnabled)) {
        const schemaDef = (section.registry.schemas || []).find((r) => r.key === schema.key);
        for (const fgKey of schemaDef?.fieldGroups?.custom || []) blockedFGKeys.add(fgKey);
        if (schemaDef?.class && !schemaDef.class.includes("://")) blockedClassKeys.add(schemaDef.class);
      }

      const foundDatasets = section.expectedSchemaDefs
        .filter((s) => datasetsByName.has(resolveName(s.name, section.isRelational)))
        .map((s) => ({
          ...s,
          title: resolveName(s.name, section.isRelational),
          datasetId: datasetsByName.get(resolveName(s.name, section.isRelational)).id,
          section: sectionTag,
        }));

      return { ...section, schemasWithStatus, foundFGs, foundClasses, foundDatasets, blockedFGKeys, blockedClassKeys };
    })
  );

  const totalFound = processedSections.reduce(
    (n, s) => n + s.schemasWithStatus.length + s.foundFGs.length + s.foundClasses.length + s.foundDatasets.length,
    0
  );

  const allDeletableSchemas = processedSections.flatMap((s) =>
    s.schemasWithStatus.filter((schema) => !schema.profileEnabled)
  );
  const allLockedSchemas = processedSections.flatMap((s) =>
    s.schemasWithStatus.filter((schema) => schema.profileEnabled)
  );
  const allDeletableFGs = processedSections.flatMap((s) =>
    s.foundFGs.filter((fg) => !s.blockedFGKeys.has(fg.key))
  );
  const allLockedFGs = processedSections.flatMap((s) =>
    s.foundFGs.filter((fg) => s.blockedFGKeys.has(fg.key))
  );
  const allDeletableClasses = processedSections.flatMap((s) =>
    s.foundClasses.filter((c) => !s.blockedClassKeys.has(c.key))
  );
  const allLockedClasses = processedSections.flatMap((s) =>
    s.foundClasses.filter((c) => s.blockedClassKeys.has(c.key))
  );
  const allDeletableDatasets = processedSections.flatMap((s) => s.foundDatasets);

  const allFoundSchemas = processedSections.flatMap((s) => s.schemasWithStatus);
  const schemaIdToSection = new Map(
    allFoundSchemas.filter((s) => s.schemaId).map((s) => [s.schemaId, s.section])
  );
  const schemaIds = new Set(schemaIdToSection.keys());
  let toDeleteDescriptors = [];
  if (schemaIds.size > 0) {
    const allDescriptors = await listDescriptors(headers);
    toDeleteDescriptors = allDescriptors
      .filter((d) => schemaIds.has(d["xdm:sourceSchema"]))
      .map((d) => ({ ...d, section: schemaIdToSection.get(d["xdm:sourceSchema"]) || "standard" }));
  }

  const totalDeletable =
    allDeletableSchemas.length +
    allDeletableFGs.length +
    allDeletableClasses.length +
    allDeletableDatasets.length +
    toDeleteDescriptors.length;

  return {
    sandbox,
    totalFound,
    totalDeletable,
    toRemove: {
      datasets: allDeletableDatasets.length,
      descriptors: toDeleteDescriptors.length,
      schemas: allDeletableSchemas.length,
      fieldGroups: allDeletableFGs.length,
      classes: allDeletableClasses.length,
    },
    locked: [
      ...allLockedSchemas.map((s) => ({ title: s.title, reason: "profile enabled", section: s.section })),
      ...allLockedFGs.map((fg) => ({ title: fg.title, reason: "field group — in use", section: fg.section })),
      ...allLockedClasses.map((cls) => ({ title: cls.title, reason: "class — in use", section: cls.section })),
    ],
    deletable: {
      datasets: allDeletableDatasets,
      descriptors: toDeleteDescriptors,
      schemas: allDeletableSchemas,
      fieldGroups: allDeletableFGs,
      classes: allDeletableClasses,
    },
  };
}

/**
 * Executes sandbox cleanup using the result from inspectSchemaModel.
 * Deletes all deletable artifacts in dependency order, then verifies
 * every artifact is actually absent from the sandbox API.
 *
 * @param {Object} inspection - Result from inspectSchemaModel
 * @param {Object} envMap
 * @param {string} accessToken
 */
export async function cleanSchemaModel(inspection, envMap, accessToken) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
  };

  async function deleteGroup(label, items, deleteFn) {
    if (items.length === 0) return;
    let passed = 0;
    let failed = 0;
    for (const item of items) {
      try {
        await deleteFn(item);
        passed++;
      } catch {
        failed++;
      }
    }
    if (failed === 0) {
      console.log(chalk.green("  ✓") + `  ${label} (${passed}/${items.length})`);
    } else {
      console.log(chalk.yellow("  !") + `  ${label} (${passed}/${items.length} removed, ${failed} could not be removed)`);
    }
  }

  const { deletable } = inspection;

  await deleteGroup("Datasets",     deletable.datasets,    (d)   => deleteDataset(accessToken, envMap, d.datasetId));
  await deleteGroup("Descriptors",  deletable.descriptors, (d)   => deleteDescriptor(accessToken, envMap, d["@id"]));
  await deleteGroup("Schemas",      deletable.schemas,     (s)   => deleteSchema(accessToken, envMap, s.altId));
  await deleteGroup("Field Groups", deletable.fieldGroups, (fg)  => deleteFieldGroup(accessToken, envMap, fg.altId));
  await deleteGroup("Classes",      deletable.classes,     (cls) => deleteClass(accessToken, envMap, cls.altId));

  // Verify every deleted artifact is actually gone from the API
  const expectedGoneSchemas  = new Set(deletable.schemas.map((s) => s.title));
  const expectedGoneFGs      = new Set(deletable.fieldGroups.map((fg) => fg.title));
  const expectedGoneClasses  = new Set(deletable.classes.map((c) => c.title));
  const expectedGoneDatasets = new Set(deletable.datasets.map((d) => d.title));

  const verifyChecks = [];
  if (expectedGoneSchemas.size)
    verifyChecks.push(listResource("schemas", headers).then((r) => r.filter((s) => expectedGoneSchemas.has(s.title)).map((s) => `Schema: ${s.title}`)));
  if (expectedGoneFGs.size)
    verifyChecks.push(listResource("mixins", headers).then((r) => r.filter((fg) => expectedGoneFGs.has(fg.title)).map((fg) => `Field Group: ${fg.title}`)));
  if (expectedGoneClasses.size)
    verifyChecks.push(listResource("classes", headers).then((r) => r.filter((c) => expectedGoneClasses.has(c.title)).map((c) => `Class: ${c.title}`)));
  if (expectedGoneDatasets.size)
    verifyChecks.push(listDatasets(headers).then((r) => r.filter((d) => expectedGoneDatasets.has(d.name)).map((d) => `Dataset: ${d.name}`)));

  const stillPresent = (await Promise.all(verifyChecks)).flat();
  return { stillPresent };
}
