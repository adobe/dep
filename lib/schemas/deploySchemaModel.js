import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import axios from "axios";
import chalk from "chalk";
import { getTenantId } from "./getTenantId.js";
import { createNamespace } from "../identity/createNamespace.js";
import { createClass } from "./createClass.js";
import { createFieldGroup } from "./createFieldGroup.js";
import { createSchema } from "./createSchema.js";
import { enableProfileSchema } from "./enableProfileSchema.js";
import { createDescriptor } from "./descriptors/createDescriptor.js";
import { createDataset } from "../datasets/createDataset.js";
import { enableProfileDataset } from "../datasets/enableProfileDataset.js";
import { PREFIX_STANDARD, PREFIX_RELATIONAL } from "../constants/prefix.js";

const PROPAGATION_DELAY_MS = 60_000;
const STEP_PAUSE_MS = 1_000;

/**
 * Orchestrates schema model deployment for a given pack manifest.
 * Reads deploy.yaml from deployYamlPath, derives the catalog registry
 * from the sibling standard/ or relational/ directory, then dispatches:
 *   "standard"   — custom classes, field groups, dynamic allOf assembly, profile enablement
 *   "relational" — static schema body files, PK, version, and FK descriptors, datasets
 *
 * @param {string} deployYamlPath - Absolute path to the pack manifest deploy.yaml.
 * @param {Object} envMap - Environment variables (API_KEY, IMS_ORG, SANDBOX_NAME, etc.).
 * @param {string} accessToken - Bearer token for Adobe IMS.
 * @param {Object} [options] - Optional flags.
 * @param {string} options.type - Required: "standard" or "relational".
 * @param {boolean} [options.enableProfile] - (standard only) Enable schemas/datasets for Real-time Customer Profile.
 */
export async function deploySchemaModel(deployYamlPath, envMap, accessToken, options = {}) {
  const { type } = options;
  if (!type) {
    throw new Error(`options.type ("standard" or "relational") is required: ${deployYamlPath}`);
  }

  const projectRoot = process.cwd();
  const deployYaml = yaml.load(fs.readFileSync(deployYamlPath, "utf8"));
  const packDir = path.dirname(deployYamlPath);

  // deploy.yaml lives at {vertical}/lab-packs/{pack}/deploy.yaml
  // catalog lives at {vertical}/{standard|relational}/schemas.yaml — go up two levels
  const catalogDir = type === "standard" ? "standard" : "relational";
  const registryPath = path.resolve(packDir, "..", "..", catalogDir, "schemas.yaml");
  const registry = yaml.load(fs.readFileSync(registryPath, "utf8"));

  if (type === "standard") return _deployStandard(deployYaml, registry, envMap, accessToken, projectRoot, options);
  if (type === "relational") return _deployRelational(deployYaml, registry, envMap, accessToken, projectRoot, options);

  throw new Error(`Unknown type "${type}"`);
}

// ---------------------------------------------------------------------------
// Standard XDM deployment
// ---------------------------------------------------------------------------

async function _deployStandard(deployYaml, registry, envMap, accessToken, projectRoot, options = {}) {
  console.log("\nDeploying standard schema model...\n");

  const resolveName = (name) => name.replace(/\{PREFIX_NAME\}/g, PREFIX_STANDARD);

  const selectedSchemaKeys = new Set(deployYaml.standard?.schemas || []);
  const selectedSchemaDefs = (registry.schemas || []).filter((s) => selectedSchemaKeys.has(s.key));

  // All custom namespace codes in the catalog (distinguishes custom from AEP built-ins)
  const allRegistryNamespaceCodes = new Set((registry.identityNamespaces || []).map((n) => n.code));

  const derivedFieldGroupKeys = new Set();
  for (const schemaDef of selectedSchemaDefs) {
    for (const fgKey of (schemaDef.fieldGroups?.custom || [])) {
      derivedFieldGroupKeys.add(fgKey);
    }
  }
  const selectedFieldGroupDefs = (registry.fieldGroups || []).filter((fg) =>
    derivedFieldGroupKeys.has(fg.key)
  );

  // non-URL values are custom class keys, not $id URIs
  const derivedClassKeys = new Set();
  for (const schemaDef of selectedSchemaDefs) {
    if (schemaDef.class && !schemaDef.class.includes("://")) derivedClassKeys.add(schemaDef.class);
  }
  for (const fgDef of selectedFieldGroupDefs) {
    if (fgDef.intendedToExtend && !fgDef.intendedToExtend.includes("://")) {
      derivedClassKeys.add(fgDef.intendedToExtend);
    }
  }
  const selectedClassDefs = (registry.classes || []).filter((c) => derivedClassKeys.has(c.key));

  const createdNamespaceCodes = new Set();
  for (const schemaDef of selectedSchemaDefs) {
    for (const desc of schemaDef.identityDescriptors || []) {
      createdNamespaceCodes.add(desc.namespace);
    }
  }
  const selectedNamespaceDefs = (registry.identityNamespaces || []).filter((n) =>
    createdNamespaceCodes.has(n.code)
  );

  try {
    const [existingClasses, existingFGs, existingSchemas, existingDatasets] = await Promise.all([
      _listExisting("classes", envMap, accessToken),
      _listExisting("mixins", envMap, accessToken),
      _listExisting("schemas", envMap, accessToken),
      _listExistingDatasets(envMap, accessToken),
    ]);
    const existingClassesByTitle = new Map(existingClasses.map((c) => [c.title, c]));
    const existingFGsByTitle = new Map(existingFGs.map((fg) => [fg.title, fg]));
    const existingSchemasByTitle = new Map(existingSchemas.map((s) => [s.title, s]));

    // Step 1: Identity namespaces
    console.log("  Creating identity namespaces...");
    let namespacesSkipped = 0;
    for (const ns of selectedNamespaceDefs) {
      const result = await createNamespace(accessToken, envMap, ns);
      if (result.alreadyExisted) namespacesSkipped++;
    }
    const nsSkippedSuffix = namespacesSkipped > 0 ? ` — ${namespacesSkipped} already existed` : "";
    console.log(
      chalk.green("  ✓") +
        ` Identity namespaces created (${selectedNamespaceDefs.length}/${selectedNamespaceDefs.length}${nsSkippedSuffix})`
    );
    await new Promise((r) => setTimeout(r, STEP_PAUSE_MS));

    // Step 2: Classes (hardcoded record-type body — all custom classes extend xdm/data/record)
    const classIdMap = new Map();
    if (selectedClassDefs.length > 0) {
      console.log("  Creating classes...");
      let classesSkipped = 0;
      for (const classDef of selectedClassDefs) {
        const resolvedName = resolveName(classDef.name);
        const existing = existingClassesByTitle.get(resolvedName);
        if (existing) {
          classIdMap.set(classDef.key, { classId: existing["$id"], altId: existing["meta:altId"] });
          classesSkipped++;
          continue;
        }
        const classBody = {
          type: "object",
          title: resolvedName,
          description: classDef.description || resolvedName,
          allOf: [{ $ref: "https://ns.adobe.com/xdm/data/record" }],
        };
        const { classId, altId } = await createClass(accessToken, envMap, classBody);
        classIdMap.set(classDef.key, { classId, altId });
      }
      const classSkippedSuffix = classesSkipped > 0 ? ` — ${classesSkipped} already existed` : "";
      console.log(
        chalk.green("  ✓") + ` Classes (${classIdMap.size}/${selectedClassDefs.length}${classSkippedSuffix})`
      );
      await new Promise((r) => setTimeout(r, STEP_PAUSE_MS));
    }

    // Step 3: Tenant ID
    let tenantId;
    try {
      ({ tenantId } = await getTenantId(accessToken, envMap));
    } catch (err) {
      console.log(chalk.red("  ✗") + ` ${err.message}`);
      console.log("\n  Deployment failed — cannot determine tenant ID.\n");
      throw err;
    }

    // Step 4: Field groups (file = definitions.customFields.properties content only; build full body here)
    console.log("  Creating field groups...");
    const fieldGroupIdMap = new Map();
    let fgsSkipped = 0;
    for (const fgDef of selectedFieldGroupDefs) {
      const resolvedName = resolveName(fgDef.name);
      const existing = existingFGsByTitle.get(resolvedName);
      if (existing) {
        fieldGroupIdMap.set(fgDef.key, { fieldGroupId: existing["$id"], altId: existing["meta:altId"] });
        fgsSkipped++;
        continue;
      }

      let raw = fs.readFileSync(path.resolve(projectRoot, fgDef.file), "utf8");
      raw = raw.replace(/\{tenantId\}/g, tenantId);
      const customFieldsProperties = JSON.parse(raw);

      // Resolve intendedToExtend: URL used as-is; custom class key resolved via classIdMap
      const isCustomClass = fgDef.intendedToExtend && !fgDef.intendedToExtend.includes("://");
      const cls = isCustomClass ? classIdMap.get(fgDef.intendedToExtend) : null;
      if (isCustomClass && !cls) throw new Error(`Field group "${fgDef.key}" references class "${fgDef.intendedToExtend}" which was not deployed`);
      const intendedUrl = isCustomClass ? cls.classId : fgDef.intendedToExtend;

      // Pattern A: single allOf entry. Pattern B (extends present): two-entry allOf + meta:extends flags.
      const fgBody = {
        type: "object",
        title: resolvedName,
        description: fgDef.description || resolvedName,
        "meta:intendedToExtend": [intendedUrl],
        definitions: { customFields: { type: "object", properties: customFieldsProperties } },
        allOf: fgDef.extends
          ? [{ $ref: fgDef.extends }, { $ref: "#/definitions/customFields" }]
          : [{ $ref: "#/definitions/customFields" }],
        ...(fgDef.extends
          ? { "meta:extends": [fgDef.extends], "meta:extensible": true, "meta:abstract": true }
          : {}),
      };

      const { fieldGroupId, altId } = await createFieldGroup(accessToken, envMap, fgBody);
      fieldGroupIdMap.set(fgDef.key, { fieldGroupId, altId });
    }
    const fgSkippedSuffix = fgsSkipped > 0 ? ` — ${fgsSkipped} already existed` : "";
    console.log(
      chalk.green("  ✓") +
        ` Field groups (${fieldGroupIdMap.size}/${selectedFieldGroupDefs.length}${fgSkippedSuffix})`
    );
    await new Promise((r) => setTimeout(r, STEP_PAUSE_MS));

    // Step 5: Schemas (allOf = [classRef, ...ootbRefs, ...customFGIds])
    console.log("  Creating schemas...");
    const schemaIdMap = new Map();
    let schemasSkipped = 0;
    for (const schemaDef of selectedSchemaDefs) {
      const resolvedName = resolveName(schemaDef.name);
      const existing = existingSchemasByTitle.get(resolvedName);
      if (existing) {
        schemaIdMap.set(schemaDef.key, { schemaId: existing["$id"], altId: existing["meta:altId"] });
        schemasSkipped++;
        continue;
      }

      const isCustomClass = schemaDef.class && !schemaDef.class.includes("://");
      let classRef;
      if (isCustomClass) {
        const cls = classIdMap.get(schemaDef.class);
        if (!cls) throw new Error(`Schema "${schemaDef.key}" references class "${schemaDef.class}" which was not deployed`);
        classRef = { $ref: cls.classId };
      } else {
        classRef = { $ref: schemaDef.class };
      }

      const ootbRefs = (schemaDef.fieldGroups?.ootb || []).map((url) => ({ $ref: url }));
      const customRefs = (schemaDef.fieldGroups?.custom || []).map((key) => {
        const fg = fieldGroupIdMap.get(key);
        if (!fg) throw new Error(`Schema "${schemaDef.key}" references field group "${key}" which was not deployed`);
        return { $ref: fg.fieldGroupId };
      });

      const { schemaId, altId } = await createSchema(accessToken, envMap, {
        type: "object",
        title: resolvedName,
        description: schemaDef.description || resolvedName,
        allOf: [classRef, ...ootbRefs, ...customRefs],
      });
      schemaIdMap.set(schemaDef.key, { schemaId, altId });
    }
    const schemaSkippedSuffix = schemasSkipped > 0 ? ` — ${schemasSkipped} already existed` : "";
    console.log(
      chalk.green("  ✓") + ` Schemas (${schemaIdMap.size}/${selectedSchemaDefs.length}${schemaSkippedSuffix})`
    );
    await new Promise((r) => setTimeout(r, STEP_PAUSE_MS));

    console.log("  Creating descriptors...");
    const existingDescriptors = await _listExistingDescriptors(envMap, accessToken);
    let identityCount = 0;
    let relationshipCount = 0;
    let refIdentityCount = 0;
    let friendlyNameCount = 0;
    let descriptorsSkipped = 0;

    for (const schemaDef of selectedSchemaDefs) {
      const schemaEntry = schemaIdMap.get(schemaDef.key);
      if (!schemaEntry) continue;
      const { schemaId } = schemaEntry;

      for (const desc of schemaDef.identityDescriptors || []) {
        const sourceProperty = desc.sourceProperty.replace(/\{tenantId\}/g, tenantId);
        const fp = _descFingerprint({ "@type": "xdm:descriptorIdentity", "xdm:sourceSchema": schemaId, "xdm:sourceProperty": sourceProperty });
        if (existingDescriptors.has(fp)) { identityCount++; descriptorsSkipped++; continue; }
        await createDescriptor(accessToken, envMap, {
          "@type": "xdm:descriptorIdentity",
          "xdm:sourceSchema": schemaId,
          "xdm:sourceVersion": 1,
          "xdm:sourceProperty": sourceProperty,
          "xdm:namespace": desc.namespace,
          "xdm:property": "xdm:code",
          "xdm:isPrimary": desc.isPrimary,
        });
        identityCount++;
      }

      for (const desc of schemaDef.relationshipDescriptors || []) {
        if (!selectedSchemaKeys.has(desc.destinationSchema)) continue;
        const destEntry = schemaIdMap.get(desc.destinationSchema);
        if (!destEntry) continue;
        const sourceProperty = desc.sourceProperty.replace(/\{tenantId\}/g, tenantId);
        const destinationProperty = desc.destinationProperty.replace(/\{tenantId\}/g, tenantId);
        const fp = _descFingerprint({ "@type": "xdm:descriptorOneToOne", "xdm:sourceSchema": schemaId, "xdm:sourceProperty": sourceProperty });
        if (existingDescriptors.has(fp)) { relationshipCount++; descriptorsSkipped++; continue; }
        await createDescriptor(accessToken, envMap, {
          "@type": "xdm:descriptorOneToOne",
          "xdm:sourceSchema": schemaId,
          "xdm:sourceVersion": 1,
          "xdm:sourceProperty": sourceProperty,
          "xdm:destinationSchema": destEntry.schemaId,
          "xdm:destinationVersion": 1,
          "xdm:destinationProperty": destinationProperty,
        });
        relationshipCount++;
      }

      for (const desc of schemaDef.referenceIdentityDescriptors || []) {
        // Skip custom namespaces not being created in this deployment
        if (allRegistryNamespaceCodes.has(desc.namespace) && !createdNamespaceCodes.has(desc.namespace)) continue;
        const sourceProperty = desc.sourceProperty.replace(/\{tenantId\}/g, tenantId);
        const fp = _descFingerprint({ "@type": "xdm:descriptorReferenceIdentity", "xdm:sourceSchema": schemaId, "xdm:sourceProperty": sourceProperty });
        if (existingDescriptors.has(fp)) { refIdentityCount++; descriptorsSkipped++; continue; }
        await createDescriptor(accessToken, envMap, {
          "@type": "xdm:descriptorReferenceIdentity",
          "xdm:sourceSchema": schemaId,
          "xdm:sourceVersion": 1,
          "xdm:sourceProperty": sourceProperty,
          "xdm:identityNamespace": desc.namespace,
        });
        refIdentityCount++;
      }

      for (const desc of schemaDef.friendlyNameDescriptors || []) {
        const fp = _descFingerprint({ "@type": "xdm:alternateDisplayInfo", "xdm:sourceSchema": schemaId, "xdm:sourceProperty": desc.sourceProperty });
        if (existingDescriptors.has(fp)) { friendlyNameCount++; descriptorsSkipped++; continue; }
        await createDescriptor(accessToken, envMap, {
          "@type": "xdm:alternateDisplayInfo",
          "xdm:sourceSchema": schemaId,
          "xdm:sourceVersion": 1,
          "xdm:sourceProperty": desc.sourceProperty,
          "xdm:title": { en_us: desc.title },
          "xdm:description": { en_us: desc.description },
          "meta:enum": desc.metaEnum || {},
        });
        friendlyNameCount++;
      }
    }

    const totalDescriptors = identityCount + relationshipCount + refIdentityCount + friendlyNameCount;
    const descSkippedSuffix = descriptorsSkipped > 0 ? ` — ${descriptorsSkipped} already existed` : "";
    console.log(
      chalk.green("  ✓") + ` Descriptors created (${totalDescriptors}/${totalDescriptors}${descSkippedSuffix})`
    );
    await new Promise((r) => setTimeout(r, STEP_PAUSE_MS));

    // Step 7: Datasets (1:1 with schemas; dataset name = resolved schema name)
    console.log("  Creating datasets...");
    const datasetIdMap = new Map();
    let datasetsSkipped = 0;
    for (const schemaDef of selectedSchemaDefs) {
      const resolvedName = resolveName(schemaDef.name);
      if (existingDatasets.has(resolvedName)) {
        datasetIdMap.set(schemaDef.key, existingDatasets.get(resolvedName));
        datasetsSkipped++;
        continue;
      }
      const { schemaId } = schemaIdMap.get(schemaDef.key);
      const datasetId = await createDataset(accessToken, envMap, resolvedName, schemaId);
      datasetIdMap.set(schemaDef.key, datasetId);
    }
    const datasetSkippedSuffix = datasetsSkipped > 0 ? ` — ${datasetsSkipped} already existed` : "";
    console.log(
      chalk.green("  ✓") + ` Datasets created (${datasetIdMap.size}/${selectedSchemaDefs.length}${datasetSkippedSuffix})`
    );
    await new Promise((r) => setTimeout(r, STEP_PAUSE_MS));

    // Step 8: Profile enablement (caller decides via options.enableProfile)
    if (options.enableProfile) {
      console.log();
      console.log("  Enabling schemas for profile...");
      let schemasAlreadyEnabled = 0;
      for (const schemaDef of selectedSchemaDefs) {
        const { altId } = schemaIdMap.get(schemaDef.key);
        const result = await enableProfileSchema(accessToken, envMap, altId);
        if (result?.alreadyEnabled) schemasAlreadyEnabled++;
      }
      const schemaEnableSuffix = schemasAlreadyEnabled > 0 ? ` — ${schemasAlreadyEnabled} already enabled` : "";
      console.log(chalk.green("  ✓") + ` Schemas enabled for profile (${selectedSchemaDefs.length}/${selectedSchemaDefs.length}${schemaEnableSuffix})`);

      const newlyEnabled = selectedSchemaDefs.length - schemasAlreadyEnabled;
      if (newlyEnabled > 0) {
        console.log("  Waiting 60s for schema propagation...");
        await new Promise((r) => setTimeout(r, PROPAGATION_DELAY_MS));
        console.log(chalk.green("  ✓") + " Propagation complete");
      }

      console.log("  Enabling datasets for profile...");
      let datasetsAlreadyEnabled = 0;
      for (const [, datasetId] of datasetIdMap) {
        const result = await enableProfileDataset(accessToken, envMap, datasetId);
        if (result?.alreadyEnabled) datasetsAlreadyEnabled++;
      }
      const datasetEnableSuffix = datasetsAlreadyEnabled > 0 ? ` — ${datasetsAlreadyEnabled} already enabled` : "";
      console.log(chalk.green("  ✓") + ` Datasets enabled for profile (${datasetIdMap.size}/${datasetIdMap.size}${datasetEnableSuffix})`);
    }
    console.log();

    return { tenantId, schemas: Object.fromEntries(schemaIdMap), fieldGroups: Object.fromEntries(fieldGroupIdMap) };
  } catch (err) {
    _logFailure(err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Relational deployment
// ---------------------------------------------------------------------------

async function _deployRelational(deployYaml, registry, envMap, accessToken, projectRoot, options = {}) {
  console.log("\nDeploying relational schema model...\n");

  const resolveName = (name) => name.replace(/\{PREFIX_NAME\}/g, PREFIX_RELATIONAL);

  const selectedSchemaKeys = new Set(deployYaml.relational?.schemas || []);
  const namespaceDefs = registry.identityNamespaces || [];
  const selectedSchemas = (registry.schemas || []).filter((s) => selectedSchemaKeys.has(s.key));
  const schemaByKey = new Map((registry.schemas || []).map((s) => [s.key, s]));

  try {
    const [existingSchemas, existingDescriptors, existingDatasets] = await Promise.all([
      _listExisting("schemas", envMap, accessToken),
      _listExistingDescriptors(envMap, accessToken),
      _listExistingDatasets(envMap, accessToken),
    ]);
    const existingSchemasByTitle = new Map(existingSchemas.map((s) => [s.title, s]));

    // Step 1: Identity namespaces
    console.log("  Creating identity namespaces...");
    let namespacesSkipped = 0;
    for (const ns of namespaceDefs) {
      const result = await createNamespace(accessToken, envMap, ns);
      if (result.alreadyExisted) namespacesSkipped++;
    }
    const nsSkippedSuffix = namespacesSkipped > 0 ? ` — ${namespacesSkipped} already existed` : "";
    console.log(
      chalk.green("  ✓") +
        ` Identity namespaces created (${namespaceDefs.length}/${namespaceDefs.length}${nsSkippedSuffix})`
    );
    await new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS));

    // Step 2: Schemas (file = properties content only; build full body here)
    console.log("  Creating schemas...");
    const schemaIdMap = new Map();
    let schemasSkipped = 0;
    for (const schemaDef of selectedSchemas) {
      const resolvedName = resolveName(schemaDef.name);
      const existing = existingSchemasByTitle.get(resolvedName);
      if (existing) {
        schemaIdMap.set(schemaDef.key, { schemaId: existing["$id"], altId: existing["meta:altId"] });
        schemasSkipped++;
        continue;
      }
      const schemaProps = JSON.parse(
        fs.readFileSync(path.resolve(projectRoot, schemaDef.file), "utf8")
      );
      const required = [
        ...(schemaDef.primaryKey ? [schemaDef.primaryKey] : []),
        ...(schemaDef.versionField ? [schemaDef.versionField] : []),
      ];
      const schemaBody = {
        type: "object",
        title: resolvedName,
        description: schemaDef.description || resolvedName,
        "meta:extends": ["https://ns.adobe.com/xdm/data/adhoc-v2"],
        "meta:behaviorType": "record",
        definitions: { customFields: { type: "object", properties: schemaProps } },
        allOf: [{ $ref: "#/definitions/customFields", "meta:xdmType": "object" }],
      };
      if (required.length > 0) schemaBody.required = required;
      const { schemaId, altId } = await createSchema(accessToken, envMap, schemaBody);
      schemaIdMap.set(schemaDef.key, { schemaId, altId });
    }
    const schemaSkippedSuffix = schemasSkipped > 0 ? ` — ${schemasSkipped} already existed` : "";
    console.log(
      chalk.green("  ✓") + ` Schemas created (${schemaIdMap.size}/${selectedSchemas.length}${schemaSkippedSuffix})`
    );
    await new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS));

    // Step 3: PK, version, and FK descriptors (adhoc-v2 schemas require PK + version descriptors before datasets)
    console.log("  Creating descriptors...");
    let descriptorCount = 0;
    let descriptorsSkipped = 0;

    // 3a: Primary key and version descriptors (required by Catalog API before dataset creation)
    for (const schemaDef of selectedSchemas) {
      const entry = schemaIdMap.get(schemaDef.key);
      if (!entry) continue;
      const { schemaId } = entry;

      if (schemaDef.primaryKey) {
        const fp = _descFingerprint({ "@type": "xdm:descriptorPrimaryKey", "xdm:sourceSchema": schemaId, "xdm:sourceProperty": `/${schemaDef.primaryKey}` });
        if (existingDescriptors.has(fp)) { descriptorCount++; descriptorsSkipped++; }
        else {
          await createDescriptor(accessToken, envMap, {
            "@type": "xdm:descriptorPrimaryKey",
            "xdm:sourceSchema": schemaId,
            "xdm:sourceVersion": 1,
            "xdm:sourceProperty": `/${schemaDef.primaryKey}`,
          });
          descriptorCount++;
        }
      }

      if (schemaDef.versionField) {
        const fp = _descFingerprint({ "@type": "xdm:descriptorVersion", "xdm:sourceSchema": schemaId, "xdm:sourceProperty": `/${schemaDef.versionField}` });
        if (existingDescriptors.has(fp)) { descriptorCount++; descriptorsSkipped++; }
        else {
          await createDescriptor(accessToken, envMap, {
            "@type": "xdm:descriptorVersion",
            "xdm:sourceSchema": schemaId,
            "xdm:sourceVersion": 1,
            "xdm:sourceProperty": `/${schemaDef.versionField}`,
          });
          descriptorCount++;
        }
      }
    }

    // 3b: FK (relationship) descriptors
    for (const schemaDef of selectedSchemas) {
      for (const fk of schemaDef.foreignKeys || []) {
        if (!selectedSchemaKeys.has(fk.destinationSchema)) continue;
        const srcEntry = schemaIdMap.get(schemaDef.key);
        const dstEntry = schemaIdMap.get(fk.destinationSchema);
        if (!srcEntry || !dstEntry) continue;

        const fp = _descFingerprint({
          "@type": "xdm:descriptorRelationship",
          "xdm:sourceSchema": srcEntry.schemaId,
          "xdm:sourceProperty": [`/${fk.sourceProperty}`],
        });
        if (existingDescriptors.has(fp)) { descriptorCount++; descriptorsSkipped++; continue; }

        const destSchemaDef = schemaByKey.get(fk.destinationSchema);
        await createDescriptor(accessToken, envMap, {
          "@type": "xdm:descriptorRelationship",
          "xdm:sourceSchema": srcEntry.schemaId,
          "xdm:sourceProperty": [`/${fk.sourceProperty}`],
          "xdm:sourceVersion": 1,
          "xdm:destinationSchema": dstEntry.schemaId,
          "xdm:destinationProperty": [`/${fk.destinationProperty}`],
          "xdm:destinationVersion": 1,
          "xdm:cardinality": fk.cardinality,
          "xdm:sourceToDestinationTitle": destSchemaDef ? resolveName(destSchemaDef.name) : fk.destinationSchema,
          "xdm:destinationToSourceTitle": resolveName(schemaDef.name),
        });
        descriptorCount++;
      }
    }

    const descSkippedSuffix = descriptorsSkipped > 0 ? ` — ${descriptorsSkipped} already existed` : "";
    console.log(
      chalk.green("  ✓") + ` Descriptors created (${descriptorCount}/${descriptorCount}${descSkippedSuffix})`
    );
    await new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS));

    // Step 4: Propagation pause — skipped if all schemas already existed
    if (schemasSkipped < selectedSchemas.length) {
      console.log("  Waiting 60s for schema propagation...");
      await new Promise((resolve) => setTimeout(resolve, PROPAGATION_DELAY_MS));
      console.log(chalk.green("  ✓") + " Schema propagation complete");
      await new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS));
    }

    // Step 5: Datasets
    console.log("  Creating datasets...");
    const datasetIdMap = new Map();
    let datasetsSkipped = 0;
    for (const schemaDef of selectedSchemas) {
      const resolvedName = resolveName(schemaDef.name);
      if (existingDatasets.has(resolvedName)) {
        datasetIdMap.set(schemaDef.key, existingDatasets.get(resolvedName));
        datasetsSkipped++;
        continue;
      }
      const { schemaId } = schemaIdMap.get(schemaDef.key);
      const datasetId = await createDataset(accessToken, envMap, resolvedName, schemaId);
      datasetIdMap.set(schemaDef.key, datasetId);
    }
    const datasetSkippedSuffix = datasetsSkipped > 0 ? ` — ${datasetsSkipped} already existed` : "";
    console.log(
      chalk.green("  ✓") + ` Datasets created (${datasetIdMap.size}/${selectedSchemas.length}${datasetSkippedSuffix})`
    );
    await new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS));

    return { schemas: Object.fromEntries(schemaIdMap), datasets: Object.fromEntries(datasetIdMap) };
  } catch (err) {
    _logFailure(err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function _descFingerprint(d) {
  const prop = Array.isArray(d["xdm:sourceProperty"])
    ? d["xdm:sourceProperty"].join(",")
    : (d["xdm:sourceProperty"] || "");
  return `${d["@type"]}|${d["xdm:sourceSchema"]}|${prop}`;
}

async function _listExistingDatasets(envMap, accessToken) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;
  const url = "https://platform.adobe.io/data/foundation/catalog/dataSets?limit=100";
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-api-key": apiKey,
      "x-gw-ims-org-id": imsOrg,
      "x-sandbox-name": sandbox,
    },
  });
  return new Map(Object.entries(response.data || {}).map(([id, ds]) => [ds.name, id]));
}

async function _listExistingDescriptors(envMap, accessToken) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;
  const url = "https://platform.adobe.io/data/foundation/schemaregistry/tenant/descriptors?limit=100";
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-api-key": apiKey,
      "x-gw-ims-org-id": imsOrg,
      "x-sandbox-name": sandbox,
      Accept: "application/vnd.adobe.xdm+json",
    },
  });
  const all = Object.values(response.data || {}).flat().filter((d) => d && typeof d === "object");
  return new Set(all.map(_descFingerprint));
}

async function _listExisting(type, envMap, accessToken) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;
  const url = `https://platform.adobe.io/data/foundation/schemaregistry/tenant/${type}?limit=100`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-api-key": apiKey,
      "x-gw-ims-org-id": imsOrg,
      "x-sandbox-name": sandbox,
      Accept: "application/vnd.adobe.xed-id+json",
    },
  });
  return response.data?.results || [];
}

function _logFailure(err) {
  console.log("\n" + chalk.red("  ✗") + ` ${err.message}`);
  console.log("\n  Deployment stopped. Items created before this failure remain in the sandbox.");
  console.log("  Fix the issue and re-run — already created items will be skipped.");
  console.log('  Or run "Clean sandbox" to remove everything and start fresh.\n');
}
