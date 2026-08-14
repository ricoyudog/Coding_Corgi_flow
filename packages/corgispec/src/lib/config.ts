import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as yaml from "js-yaml";

/**
 * OpenSpec schema name. OpenSpec 1.6 supports project-defined schemas, so
 * Corgi must not narrow this to the two schemas it happens to bundle.
 */
export type SchemaType = string;

/** Schemas bundled by Corgi for fresh installations. */
export type BundledSchemaType = "gitlab-tracked" | "github-tracked";

export type TrackingProvider = "github" | "gitlab" | "none";

export interface TrackingConfig {
  provider: TrackingProvider;
}

export type CorgiContract = "rfc-v1";

export interface GovernanceConfig {
  integrationBranch: string;
}

export interface CorgiConfig {
  tracking?: TrackingConfig;
  taskArtifactId?: string;
  contract?: CorgiContract;
  rfcRoot?: string;
  foundation?: string;
  governance?: GovernanceConfig;
}

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
 * The parsed and validated Corgi config.
 */
export interface OpenSpecConfig {
  schema: SchemaType;
  corgi?: CorgiConfig;
  isolation?: IsolationConfig;
  context?: string;
  rules?: RulesConfig;
}

/**
 * Raw shape of config.yaml before validation.
 */
interface RawConfig {
  schema?: unknown;
  corgi?: unknown;
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

const TRACKING_PROVIDERS: readonly TrackingProvider[] = ["github", "gitlab", "none"];
const VALID_ISOLATION_MODES = ["worktree", "none"] as const;

export interface TrackingProviderResolution {
  provider: TrackingProvider;
  source: "explicit" | "legacy-schema" | "default";
}

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
 * Load and validate the Corgi config from a file path.
 * Throws ConfigError if the file is missing, unparseable, or invalid.
 */
export function loadConfig(configPath: string): OpenSpecConfig {
  if (!existsSync(configPath)) {
    throw new ConfigError(`Config file not found: ${configPath}`);
  }

  let raw: unknown;
  try {
    const content = readFileSync(configPath, "utf-8");
    if (content.trim().length === 0) {
      throw new ConfigError("Config file is empty or not a YAML mapping");
    }
    raw = yaml.load(content);
  } catch (err) {
    if (err instanceof ConfigError) {
      throw err;
    }
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
  const schema = raw.schema.trim();
  if (schema.length === 0) {
    throw new ConfigError("Field 'schema' must be a non-empty string");
  }

  const config: OpenSpecConfig = {
    schema,
  };

  // corgi: optional Corgi-specific settings. OpenSpec owns the remaining
  // config shape; unknown top-level fields are intentionally ignored.
  if (raw.corgi !== undefined && raw.corgi !== null) {
    if (!isMapping(raw.corgi)) {
      throw new ConfigError("Field 'corgi' must be a mapping");
    }

    const corgiRaw = raw.corgi;
    const corgi: CorgiConfig = {};

    if (corgiRaw.tracking !== undefined && corgiRaw.tracking !== null) {
      if (!isMapping(corgiRaw.tracking)) {
        throw new ConfigError("Field 'corgi.tracking' must be a mapping");
      }

      const provider = corgiRaw.tracking.provider;
      if (typeof provider !== "string") {
        throw new ConfigError(
          "Field 'corgi.tracking.provider' is required when tracking is specified"
        );
      }
      if (!TRACKING_PROVIDERS.includes(provider as TrackingProvider)) {
        throw new ConfigError(
          `Invalid corgi.tracking.provider '${provider}'. Supported: ${TRACKING_PROVIDERS.join(", ")}`
        );
      }
      corgi.tracking = { provider: provider as TrackingProvider };
    }

    if (corgiRaw.taskArtifactId !== undefined && corgiRaw.taskArtifactId !== null) {
      if (
        typeof corgiRaw.taskArtifactId !== "string" ||
        corgiRaw.taskArtifactId.trim().length === 0
      ) {
        throw new ConfigError("Field 'corgi.taskArtifactId' must be a non-empty string");
      }
      corgi.taskArtifactId = corgiRaw.taskArtifactId.trim();
    }

    if (corgiRaw.contract !== undefined && corgiRaw.contract !== null) {
      if (corgiRaw.contract !== "rfc-v1") {
        throw new ConfigError("Field 'corgi.contract' must be 'rfc-v1'");
      }
      corgi.contract = "rfc-v1";
    }

    if (corgiRaw.rfcRoot !== undefined && corgiRaw.rfcRoot !== null) {
      if (!isSafeRelativePath(corgiRaw.rfcRoot)) {
        throw new ConfigError("Field 'corgi.rfcRoot' must be a safe relative path");
      }
      corgi.rfcRoot = corgiRaw.rfcRoot.trim();
    }

    if (corgiRaw.foundation !== undefined && corgiRaw.foundation !== null) {
      if (corgiRaw.foundation !== "RFC-0001-project-foundation") {
        throw new ConfigError(
          "Field 'corgi.foundation' must be 'RFC-0001-project-foundation'"
        );
      }
      corgi.foundation = "RFC-0001-project-foundation";
    }

    if (corgiRaw.governance !== undefined && corgiRaw.governance !== null) {
      if (!isMapping(corgiRaw.governance)) {
        throw new ConfigError("Field 'corgi.governance' must be a mapping");
      }
      const integrationBranch = corgiRaw.governance.integrationBranch;
      if (
        typeof integrationBranch !== "string" ||
        integrationBranch.trim().length === 0 ||
        /[\u0000-\u001f\u007f]/.test(integrationBranch) ||
        [" ", "~", "^", ":", "?", "*", "[", "\\"].some((character) =>
          integrationBranch.includes(character)
        ) ||
        integrationBranch.includes("..") ||
        integrationBranch.startsWith("-") ||
        integrationBranch.endsWith("/") ||
        integrationBranch.endsWith(".") ||
        integrationBranch.includes("//") ||
        integrationBranch.includes("@{")
      ) {
        throw new ConfigError(
          "Field 'corgi.governance.integrationBranch' must be a valid non-empty branch name"
        );
      }
      corgi.governance = { integrationBranch: integrationBranch.trim() };
    }

    if (corgi.contract === "rfc-v1") {
      for (const [field, value] of [
        ["rfcRoot", corgi.rfcRoot],
        ["foundation", corgi.foundation],
        ["governance", corgi.governance],
      ] as const) {
        if (value === undefined) {
          throw new ConfigError(`Field 'corgi.${field}' is required for contract 'rfc-v1'`);
        }
      }
    }

    config.corgi = corgi;
  }

  // isolation: optional
  if (raw.isolation !== undefined && raw.isolation !== null) {
    if (!isMapping(raw.isolation)) {
      throw new ConfigError("Field 'isolation' must be a mapping");
    }
    const iso = raw.isolation;

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
    if (!isMapping(raw.rules)) {
      throw new ConfigError("Field 'rules' must be a mapping");
    }
    const rulesRaw = raw.rules;
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

/**
 * Resolve the issue tracker without overloading the OpenSpec schema name.
 * Legacy tracked schemas remain readable, but callers can use `source` to
 * surface an explicit migration warning in doctor output.
 */
export function resolveTrackingProvider(config: OpenSpecConfig): TrackingProviderResolution {
  const explicit = config.corgi?.tracking?.provider;
  if (explicit) {
    return { provider: explicit, source: "explicit" };
  }

  if (config.schema === "github-tracked") {
    return { provider: "github", source: "legacy-schema" };
  }
  if (config.schema === "gitlab-tracked") {
    return { provider: "gitlab", source: "legacy-schema" };
  }

  return { provider: "none", source: "default" };
}

/**
 * Resolve the artifact that carries executable tasks. The conventional
 * `tasks` id is only selected when the active schema actually exposes it.
 */
export function resolveTaskArtifactId(
  config: OpenSpecConfig,
  artifactIds: Iterable<string>
): string | null {
  const explicit = config.corgi?.taskArtifactId;
  if (explicit) {
    return explicit;
  }

  for (const artifactId of artifactIds) {
    if (artifactId === "tasks") {
      return "tasks";
    }
  }
  return null;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0
    && !trimmed.startsWith("/")
    && !trimmed.startsWith("\\")
    && !/^[A-Za-z]:/.test(trimmed)
    && !trimmed.split(/[\\/]+/).includes("..");
}
