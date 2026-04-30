import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

/**
 * Supported schema types.
 */
export type SchemaType = "gitlab-tracked" | "github-tracked";

/**
 * Isolation mode configuration.
 */
export interface IsolationConfig {
  mode: "worktree" | "none";
  root?: string;
  branch_prefix?: string;
}

/**
 * Per-artifact rule lists.
 */
export interface RulesConfig {
  [artifactId: string]: string[];
}

/**
 * The parsed and validated OpenSpec config.
 */
export interface OpenSpecConfig {
  schema: SchemaType;
  isolation?: IsolationConfig;
  context?: string;
  rules?: RulesConfig;
}

/**
 * Raw shape of config.yaml before validation.
 */
interface RawConfig {
  schema?: unknown;
  isolation?: unknown;
  context?: unknown;
  rules?: unknown;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const VALID_SCHEMAS: SchemaType[] = ["gitlab-tracked", "github-tracked"];
const VALID_ISOLATION_MODES = ["worktree", "none"] as const;

/**
 * Find and read the openspec/config.yaml file starting from a given directory.
 * Looks for `openspec/config.yaml` relative to `cwd`.
 */
export function findConfigPath(cwd: string): string | null {
  const configPath = resolve(cwd, "openspec/config.yaml");
  if (existsSync(configPath)) {
    return configPath;
  }
  return null;
}

/**
 * Load and validate the OpenSpec config from a file path.
 * Throws ConfigError if the file is missing, unparseable, or invalid.
 */
export function loadConfig(configPath: string): OpenSpecConfig {
  if (!existsSync(configPath)) {
    throw new ConfigError(`Config file not found: ${configPath}`);
  }

  let raw: unknown;
  try {
    const content = readFileSync(configPath, "utf-8");
    raw = yaml.load(content);
  } catch (err) {
    throw new ConfigError(
      `Failed to parse config YAML: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (raw === null || raw === undefined || typeof raw !== "object") {
    throw new ConfigError("Config file is empty or not a YAML mapping");
  }

  return validateConfig(raw as RawConfig);
}

/**
 * Load config from a working directory (convenience wrapper).
 */
export function loadConfigFromDir(cwd: string): OpenSpecConfig {
  const configPath = findConfigPath(cwd);
  if (!configPath) {
    throw new ConfigError(
      `No openspec/config.yaml found in ${cwd}. Run 'corgispec init' to set up.`
    );
  }
  return loadConfig(configPath);
}

/**
 * Validate raw parsed YAML against the config schema.
 */
function validateConfig(raw: RawConfig): OpenSpecConfig {
  // schema: required
  if (!raw.schema) {
    throw new ConfigError("Missing required field: 'schema'");
  }
  if (typeof raw.schema !== "string") {
    throw new ConfigError(`Field 'schema' must be a string, got ${typeof raw.schema}`);
  }
  if (!VALID_SCHEMAS.includes(raw.schema as SchemaType)) {
    throw new ConfigError(
      `Unsupported schema '${raw.schema}'. Supported: ${VALID_SCHEMAS.join(", ")}`
    );
  }

  const config: OpenSpecConfig = {
    schema: raw.schema as SchemaType,
  };

  // isolation: optional
  if (raw.isolation !== undefined && raw.isolation !== null) {
    if (typeof raw.isolation !== "object") {
      throw new ConfigError("Field 'isolation' must be a mapping");
    }
    const iso = raw.isolation as Record<string, unknown>;

    if (!iso.mode || typeof iso.mode !== "string") {
      throw new ConfigError("Field 'isolation.mode' is required when isolation is specified");
    }
    if (!VALID_ISOLATION_MODES.includes(iso.mode as (typeof VALID_ISOLATION_MODES)[number])) {
      throw new ConfigError(
        `Invalid isolation.mode '${iso.mode}'. Supported: ${VALID_ISOLATION_MODES.join(", ")}`
      );
    }

    config.isolation = {
      mode: iso.mode as "worktree" | "none",
      root: typeof iso.root === "string" ? iso.root : undefined,
      branch_prefix: typeof iso.branch_prefix === "string" ? iso.branch_prefix : undefined,
    };
  }

  // context: optional string
  if (raw.context !== undefined && raw.context !== null) {
    if (typeof raw.context !== "string") {
      throw new ConfigError("Field 'context' must be a string");
    }
    config.context = raw.context;
  }

  // rules: optional mapping of string[]
  if (raw.rules !== undefined && raw.rules !== null) {
    if (typeof raw.rules !== "object") {
      throw new ConfigError("Field 'rules' must be a mapping");
    }
    const rulesRaw = raw.rules as Record<string, unknown>;
    const rules: RulesConfig = {};
    for (const [key, value] of Object.entries(rulesRaw)) {
      if (!Array.isArray(value)) {
        throw new ConfigError(`Field 'rules.${key}' must be an array of strings`);
      }
      rules[key] = value.map((v) => String(v));
    }
    config.rules = rules;
  }

  return config;
}
