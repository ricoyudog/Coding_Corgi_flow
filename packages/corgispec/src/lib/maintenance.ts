import {
  ChangeContractError,
  type ContractAcceptance,
  type MaintenanceCategory,
} from "./change-contract.js";

export interface MaintenanceClassification {
  category: MaintenanceCategory;
  reason: string;
  boundary: string;
  acceptance: ContractAcceptance[];
}

export interface MaintenanceDiffScopeInput {
  category: MaintenanceCategory;
  changedPaths: readonly string[];
  contractRefs: readonly string[];
}

export class MaintenanceClassificationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "MaintenanceClassificationError";
  }
}

const FEATURE_BOUNDARY = /\b(?:add|new|feature|public|api|cli|config|schema|migration|database|security|privacy|compatib|boundary|behavior)\b|新增|新功能|公共|接口|命令|配置|模式|迁移|数据库|数据语义|安全|隐私|兼容|边界|行为变化/i;

const CATEGORY_PATTERNS: Array<[MaintenanceCategory, RegExp]> = [
  ["docs-only", /\b(?:docs?|documentation|readme|typo|wording)\b|文档|错字|措辞/i],
  ["test-only", /\b(?:tests?|fixtures?|coverage|assertion)\b|测试|夹具|覆盖率|断言/i],
  ["internal-refactor", /\b(?:internal|refactor|cleanup|tooling|chore)\b|内部|重构|清理|工具链/i],
  ["dependency-maintenance", /\b(?:dependency|dependencies|lockfile|patch release|security patch)\b|依赖|锁文件|补丁版本/i],
  ["contract-bug", /\b(?:bug|regression|restore|violation|incorrect)\b|缺陷|回归|恢复|违反|错误/i],
];

export function classifyMaintenance(
  description: string,
  contractRefs: string[],
): MaintenanceClassification {
  const normalized = description.trim();
  if (!normalized) {
    throw new MaintenanceClassificationError(
      "Maintenance proposal requires a concrete description",
      "MAINTENANCE_DESCRIPTION_REQUIRED",
    );
  }
  if (FEATURE_BOUNDARY.test(normalized)) {
    throw new MaintenanceClassificationError(
      "The requested change may alter a public contract or boundary; author an RFC instead",
      "RFC_REQUIRED",
    );
  }
  const matches = CATEGORY_PATTERNS
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([category]) => category);
  if (matches.length !== 1) {
    throw new MaintenanceClassificationError(
      matches.length === 0
        ? "Maintenance category is not provable from the description; author an RFC"
        : `Maintenance description is ambiguous across categories: ${matches.join(", ")}`,
      "RFC_REQUIRED",
    );
  }
  const category = matches[0]!;
  if (category === "contract-bug" && contractRefs.length === 0) {
    throw new MaintenanceClassificationError(
      "A contract-bug exemption must cite an accepted RFC AC or canonical spec",
      "MAINTENANCE_CONTRACT_REFERENCE_REQUIRED",
    );
  }
  return {
    category,
    reason: `Automatically classified as ${category} by the closed v4 exemption rules`,
    boundary: "No public behavior, API, CLI, config, schema, data, security, compatibility, migration, or module boundary change",
    acceptance: [{ id: "MC-001", evidence: category === "docs-only" ? "human" : "automated" }],
  };
}

const DOCUMENTATION_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]);
const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "gradle.lockfile",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "packages.lock.json",
  "pipfile.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "uv.lock",
  "yarn.lock",
  "go.sum",
]);
const DEPENDENCY_MANIFESTS = new Set([
  "build.gradle",
  "build.gradle.kts",
  "cargo.toml",
  "composer.json",
  "gemfile",
  "go.mod",
  "package.json",
  "pipfile",
  "pom.xml",
  "pyproject.toml",
  "requirements.in",
  "requirements.txt",
]);
const TEST_SEGMENTS = new Set([
  "__snapshots__",
  "__tests__",
  "fixtures",
  "snapshots",
  "test",
  "testdata",
  "tests",
]);
const PUBLIC_SURFACE_SEGMENTS = new Set([
  "api",
  "apis",
  "auth",
  "cli",
  "command",
  "commands",
  "config",
  "configs",
  "contract",
  "contracts",
  "data",
  "database",
  "db",
  "migration",
  "migrations",
  "public",
  "schema",
  "schemas",
  "security",
]);

/**
 * Validate implementation paths already computed by the lifecycle's Git layer.
 * Content-sensitive manifest and public-surface changes fail closed because a
 * filename alone cannot prove that the accepted contract remains unchanged.
 */
export function validateMaintenanceDiffScope(
  input: MaintenanceDiffScopeInput,
): ChangeContractError[] {
  const failures: ChangeContractError[] = [];
  if (input.category === "contract-bug" && input.contractRefs.length === 0) {
    failures.push(scopeFailure(
      "MAINTENANCE_SCOPE_REFERENCE_REQUIRED",
      "contract-bug implementation scope requires an existing RFC AC or canonical spec reference",
      [],
    ));
  }

  for (const rawPath of [...new Set(input.changedPaths)]) {
    const path = normalizeChangedPath(rawPath);
    if (!path) {
      failures.push(scopeFailure(
        "MAINTENANCE_DIFF_PATH_INVALID",
        `Changed path '${rawPath}' is not a repository-relative Git path`,
        [rawPath],
      ));
      continue;
    }
    if (path === "rfcs" || path.startsWith("rfcs/")) {
      failures.push(scopeFailure(
        "MAINTENANCE_RFC_MUTATION",
        `Maintenance may not modify RFC governance content: '${path}'`,
        [path],
      ));
      continue;
    }
    if (path === "memory/session-bridge.md") {
      // The bridge is the required durable checkpoint mirror for every Task
      // Group commit; it never broadens the maintenance implementation scope.
      continue;
    }

    if (input.category === "docs-only") {
      if (!isDocumentationPath(path)) failures.push(categoryPathFailure(input.category, path));
      continue;
    }
    if (input.category === "test-only") {
      if (!isTestPath(path)) failures.push(categoryPathFailure(input.category, path));
      continue;
    }
    if (input.category === "dependency-maintenance") {
      const basename = path.split("/").at(-1)!.toLowerCase();
      if (LOCKFILES.has(basename)) continue;
      failures.push(scopeFailure(
        DEPENDENCY_MANIFESTS.has(basename)
          ? "MAINTENANCE_DIFF_UNPROVABLE"
          : "MAINTENANCE_DIFF_SCOPE_VIOLATION",
        DEPENDENCY_MANIFESTS.has(basename)
          ? `Dependency manifest '${path}' requires a content-aware proof that no dependency or public constraint was added`
          : `dependency-maintenance may only change recognized lockfiles; found '${path}'`,
        [path],
      ));
      continue;
    }

    if (isTestPath(path) || isDocumentationPath(path)) continue;
    if (isPublicSurfacePath(path) || isDependencyPath(path)) {
      failures.push(scopeFailure(
        "MAINTENANCE_PUBLIC_SURFACE",
        `${input.category} cannot prove that public/config/schema/migration/security/data path '${path}' preserves the accepted contract`,
        [path],
      ));
    }
  }
  return failures;
}

function normalizeChangedPath(value: string): string | null {
  const path = value.trim().replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (
    !path
    || path.startsWith("/")
    || path.includes("\0")
    || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) return null;
  return path;
}

function isDocumentationPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.startsWith("docs/") || lower.startsWith("wiki/") || lower.startsWith("memory/")) return true;
  const basename = lower.split("/").at(-1)!;
  if (/^(?:readme|changelog|contributing|code_of_conduct|security|license)(?:\.[a-z0-9]+)?$/u.test(basename)) {
    return true;
  }
  if (lower.includes("/")) return false;
  const dot = lower.lastIndexOf(".");
  return dot >= 0 && DOCUMENTATION_EXTENSIONS.has(lower.slice(dot));
}

function isTestPath(path: string): boolean {
  const lower = path.toLowerCase();
  const segments = lower.split("/");
  const basename = segments.at(-1)!;
  return segments.some((segment) => TEST_SEGMENTS.has(segment))
    || /(?:^|[._-])(?:test|spec)(?:[._-]|$)/u.test(basename)
    || /^(?:vitest|jest|playwright)\.config\./u.test(basename);
}

function isDependencyPath(path: string): boolean {
  const basename = path.split("/").at(-1)!.toLowerCase();
  return LOCKFILES.has(basename) || DEPENDENCY_MANIFESTS.has(basename);
}

function isPublicSurfacePath(path: string): boolean {
  const lower = path.toLowerCase();
  const segments = lower.split("/");
  const basename = segments.at(-1)!;
  return segments.some((segment) => PUBLIC_SURFACE_SEGMENTS.has(segment))
    || /(?:^|[._-])(?:api|cli|config|contract|data|migration|openapi|schema|security)(?:[._-]|$)/u.test(basename)
    || /\.(?:avsc|graphql|proto)$/u.test(basename);
}

function categoryPathFailure(category: MaintenanceCategory, path: string): ChangeContractError {
  return scopeFailure(
    "MAINTENANCE_DIFF_SCOPE_VIOLATION",
    `${category} does not permit implementation path '${path}'`,
    [path],
  );
}

function scopeFailure(code: string, message: string, paths: string[]): ChangeContractError {
  return new ChangeContractError(message, code, paths);
}
