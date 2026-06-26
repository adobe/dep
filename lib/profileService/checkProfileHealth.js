import axios from "axios";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { loadSampleData } from "../ingestion/loadSampleData.js";
import { PREFIX_STANDARD } from "../constants/prefix.js";

/**
 * Runs health checks defined in a config YAML against the Profile Service API.
 *
 * Supported check types:
 *   profile-traits  — GET profile entity, count contributing source datasets (sources.length)
 *   profile-events  — GET experience events; one GET per identity, each compared to identity.expected
 *                     On failure, paginates events to collect _datasetId per event, resolves dataset
 *                     names via Catalog API, and returns dataset-level children diagnostics.
 *   batch-profiles  — POST batch entity lookup, count profiles found (no error)
 *   lookup-entity   — GET non-profile entity; schemaName used directly, or schemaRef resolves
 *                     custom class meta:altId from registry at runtime
 *
 * All checks use exact match: actual === check.expected (or identity.expected for profile-events).
 *
 * @param {string} accessToken
 * @param {Object} envMap
 * @param {string} healthConfigPath - Absolute path to the health config YAML.
 * @returns {Promise<{ passed: boolean, results: Array<{ label, pass, children? }> }>}
 */
export async function checkProfileHealth(accessToken, envMap, healthConfigPath) {
  const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;

  const config = yaml.load(fs.readFileSync(healthConfigPath, "utf8"));
  const checks = config.checks || [];

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": apiKey,
    "x-gw-ims-org-id": imsOrg,
    "x-sandbox-name": sandbox,
  };

  const results = [];

  for (const check of checks) {
    let actual = 0;
    let handled = false;

    try {
      if (check.type === "profile-traits") {
        const url = `https://platform.adobe.io/data/core/ups/access/entities?schema.name=_xdm.context.profile&entityId=${encodeURIComponent(check.entityId)}&entityIdNS=${encodeURIComponent(check.entityIdNS)}`;
        const r = await axios.get(url, { headers });
        const xidKey = Object.keys(r.data || {}).find((k) => k !== "_links" && k !== "_page");
        // Count only dataset ID sources (24-char hex) — excludes 'profile-streaming-segment' and similar non-dataset entries
        const sources = xidKey ? (r.data[xidKey]?.sources ?? []) : [];
        actual = sources.filter((s) => /^[0-9a-f]{24}$/.test(s)).length;
      } else if (check.type === "profile-events") {
        // Evaluate each identity independently against its own expected count
        const identityResults = await Promise.all(
          (check.identities || []).map(async (identity) => {
            const url = `https://platform.adobe.io/data/core/ups/access/entities?schema.name=_xdm.context.experienceevent&relatedSchema.name=_xdm.context.profile&entityId=${encodeURIComponent(identity.entityId)}&entityIdNS=${encodeURIComponent(identity.entityIdNS)}&mergePolicyId=none`;
            const r = await axios.get(url, { headers, validateStatus: () => true });
            const count = (r.status >= 200 && r.status < 300) ? (r.data?._page?.count || 0) : 0;
            return { identity, count, pass: count === identity.expected };
          })
        );

        // Mark handled before any async work so outer catch never triggers generic push
        handled = true;

        const allPass = identityResults.every((ir) => ir.pass);

        if (allPass) {
          results.push({ label: check.label, pass: true });
        } else {
          // Paginate all failing identities; accumulate events per dataset across all of them
          const datasetCounts = new Map();      // dsId → total event count
          const datasetIdentities = new Map();  // dsId → Set of identity objects that had events there

          try {
            for (const ir of identityResults) {
              if (ir.pass) continue;
              let nextUrl = `https://platform.adobe.io/data/core/ups/access/entities?schema.name=_xdm.context.experienceevent&relatedSchema.name=_xdm.context.profile&entityId=${encodeURIComponent(ir.identity.entityId)}&entityIdNS=${encodeURIComponent(ir.identity.entityIdNS)}`;
              while (nextUrl) {
                const pageResp = await axios.get(nextUrl, { headers, validateStatus: () => true });
                if (pageResp.status < 200 || pageResp.status >= 300) break;
                const pageData = pageResp.data || {};
                const xidKey = Object.keys(pageData).find((k) => k !== "_links" && k !== "_page");
                const rawData = xidKey ? (pageData[xidKey] || []) : [];
                // API may return an array or a numeric-keyed object — normalise to array
                const records = Array.isArray(rawData) ? rawData : Object.values(rawData);
                for (const record of records) {
                  // _datasetId sits inside the entity wrapper on experience event records
                  const dsId = record.entity?._datasetId ?? record._datasetId;
                  if (dsId) {
                    datasetCounts.set(dsId, (datasetCounts.get(dsId) || 0) + 1);
                    if (!datasetIdentities.has(dsId)) datasetIdentities.set(dsId, new Set());
                    datasetIdentities.get(dsId).add(ir.identity);
                  }
                }
                const nextCursor = pageData._page?.next;
                nextUrl = nextCursor
                  ? `https://platform.adobe.io/data/core/ups/access/entities?schema.name=_xdm.context.experienceevent&relatedSchema.name=_xdm.context.profile&entityId=${encodeURIComponent(ir.identity.entityId)}&entityIdNS=${encodeURIComponent(ir.identity.entityIdNS)}&start=${encodeURIComponent(nextCursor)}`
                  : null;
              }
            }
          } catch {
            // Pagination error — push with whatever datasets were collected before the failure
          }

          const children = [];

          if (datasetCounts.size === 0) {
            // No events in profile store — derive expected counts from sample data files,
            // the same files that are streamed through the flows.
            try {
              const packDir = path.dirname(healthConfigPath);
              const schemasYamlPath = path.resolve(packDir, "..", "..", "standard", "schemas.yaml");
              const dataLoadYamlPath = path.resolve(packDir, "..", "..", "standard", "data-load.yaml");
              const deployYamlPath = path.resolve(packDir, "deploy.yaml");

              const schemasYaml = yaml.load(fs.readFileSync(schemasYamlPath, "utf8"));
              const dataLoadYaml = yaml.load(fs.readFileSync(dataLoadYamlPath, "utf8"));
              const deployYaml = yaml.load(fs.readFileSync(deployYamlPath, "utf8"));

              // Build selected (schemaKey -> Set<id>) from deploy.yaml dataLoad references.
              const selectedIdsBySchema = new Map();
              for (const raw of (deployYaml.standard?.dataLoad || [])) {
                const [k, id] = String(raw).split(":");
                if (!k || !id) continue;
                if (!selectedIdsBySchema.has(k)) selectedIdsBySchema.set(k, new Set());
                selectedIdsBySchema.get(k).add(id);
              }

              for (const schema of (schemasYaml.schemas || [])) {
                if (schema.class !== "https://ns.adobe.com/xdm/context/experienceevent") continue;
                const dsName = schema.name.replace(/\{PREFIX_NAME\}/g, PREFIX_STANDARD);
                const selectedIds = selectedIdsBySchema.get(schema.key);
                const entries = selectedIds
                  ? (dataLoadYaml.schemas?.[schema.key] || []).filter((e) => selectedIds.has(e.id))
                  : [];
                let expected = 0;
                for (const { file, mode } of entries) {
                  const filePath = path.resolve(process.cwd(), file);
                  if (fs.existsSync(filePath)) {
                    const data = loadSampleData(filePath);
                    expected += mode === "single" ? 1 : data.length;
                  }
                }
                children.push({ label: `${dsName} — 0 events (expected ${expected})` });
              }
            } catch {
              // config unreadable — leave children empty
            }
          } else {
            // One child per dataset: resolve name via Catalog API, sum expected across contributing identities
            for (const [dsId, count] of datasetCounts.entries()) {
              let dsName;
              try {
                const catResp = await axios.get(
                  `https://platform.adobe.io/data/foundation/catalog/dataSets/${dsId}?properties=name`,
                  { headers, validateStatus: () => true }
                );
                dsName = (catResp.status >= 200 && catResp.status < 300)
                  ? catResp.data?.[dsId]?.name
                  : undefined;
              } catch {
                dsName = undefined;
              }
              if (!dsName) dsName = `${dsId.slice(0, 5)}...${dsId.slice(-4)}`;
              const expectedSum = [...(datasetIdentities.get(dsId) || [])].reduce((s, id) => s + id.expected, 0);
              const eventWord = count === 1 ? "event" : "events";
              children.push({ label: `${dsName} — ${count} ${eventWord} (expected ${expectedSum})` });
            }
          }

          results.push({ label: check.label, pass: false, children: children.length ? children : undefined });
        }
      } else if (check.type === "batch-profiles") {
        const body = {
          schema: { name: "_xdm.context.profile" },
          fields: ["identityMap"],
          identities: check.entityIds.map((id) => ({
            entityId: String(id),
            entityIdNS: { code: check.entityIdNS },
          })),
        };
        const r = await axios.post(
          "https://platform.adobe.io/data/core/ups/access/entities",
          body,
          { headers: { ...headers, "Content-Type": "application/json" } }
        );
        const responseData = r.data || {};
        actual = Object.keys(responseData).filter((key) => {
          const record = responseData[key];
          return record && record.entity && !record.status && !record["error-code"];
        }).length;
      } else if (check.type === "lookup-entity") {
        let schemaName = check.schemaName;

        if (!schemaName && check.schemaRef) {
          // Resolve custom class meta:altId from the schema registry using the catalog
          const schemasYamlPath = path.resolve(path.dirname(healthConfigPath), "..", "..", "standard", "schemas.yaml");
          const registry = yaml.load(fs.readFileSync(schemasYamlPath, "utf8"));
          const classDef = (registry.classes || []).find((c) => c.key === check.schemaRef);
          if (classDef) {
            const resolvedClassName = classDef.name.replace(/\{PREFIX_NAME\}/g, PREFIX_STANDARD);
            const classListResp = await axios.get(
              "https://platform.adobe.io/data/foundation/schemaregistry/tenant/classes?limit=100",
              { headers: { ...headers, Accept: "application/vnd.adobe.xed-id+json" } }
            );
            const classEntry = (classListResp.data?.results || []).find((c) => c.title === resolvedClassName);
            if (classEntry) schemaName = classEntry["meta:altId"];
          }
        }

        if (schemaName) {
          const url = `https://platform.adobe.io/data/core/ups/access/entities?schema.name=${encodeURIComponent(schemaName)}&entityId=${encodeURIComponent(check.entityId)}&entityIdNS=${encodeURIComponent(check.entityIdNS)}&mergePolicyId=none`;
          const r = await axios.get(url, { headers, validateStatus: () => true });
          if (r.status >= 200 && r.status < 300) {
            const xidKey = Object.keys(r.data || {}).find((k) => k !== "_links" && k !== "_page");
            const entry = xidKey ? r.data[xidKey] : null;
            if (entry?.entity != null || (entry?.sources ?? []).length > 0) actual = 1;
          }
        }
      }
    } catch {
      actual = 0;
    }

    if (!handled) {
      const pass = actual === check.expected;
      results.push({ label: check.label, expected: check.expected, actual, pass });
    }
  }

  return {
    passed: results.every((r) => r.pass),
    results,
  };
}
