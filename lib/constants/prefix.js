// Artifact name prefixes substituted into industry YAML at deploy time.
// Standard YAMLs resolve {PREFIX_NAME} to PREFIX_STANDARD; relational YAMLs
// resolve it to PREFIX_RELATIONAL. The substituted value includes the `:`
// separator — YAML authors write `{PREFIX_NAME}` (no trailing colon).
export const PREFIX_STANDARD = "dep:";
export const PREFIX_RELATIONAL = "dep-rel:";
