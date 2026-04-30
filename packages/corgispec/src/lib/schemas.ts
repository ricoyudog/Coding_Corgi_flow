import Ajv2020, { type ValidateFunction, type ErrorObject } from "ajv/dist/2020.js";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Get the path to the bundled assets directory.
 * In the built package: dist/ → ../assets/
 * In dev (src/lib/): ../../assets/
 */
function getAssetsDir(): string {
  // Try relative to dist/ first (production)
  const fromDist = resolve(__dirname, "../assets");
  if (existsSync(fromDist)) {
    return fromDist;
  }
  // Fallback for dev (when running from src/lib/)
  const fromSrc = resolve(__dirname, "../../assets");
  if (existsSync(fromSrc)) {
    return fromSrc;
  }
  throw new SchemaError("Assets directory not found. Run 'npm run build' or 'node scripts/bundle-assets.js'.");
}

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

/**
 * Result of a schema validation.
 */
export interface ValidationResult {
  valid: boolean;
  errors?: ErrorObject[];
}

/**
 * Manages JSON Schema loading and validation.
 */
export class SchemaRegistry {
  private ajv: InstanceType<typeof Ajv2020>;
  private validators: Map<string, ValidateFunction> = new Map();
  private schemasDir: string;

  constructor(schemasDir?: string) {
    this.schemasDir = schemasDir ?? resolve(getAssetsDir(), "schemas");
    this.ajv = new Ajv2020({ allErrors: true, strict: false });
  }

  /**
   * List all available schema files.
   */
  listSchemas(): string[] {
    if (!existsSync(this.schemasDir)) {
      return [];
    }
    return readdirSync(this.schemasDir).filter((f) => f.endsWith(".json"));
  }

  /**
   * Load a schema by filename and compile it for validation.
   */
  loadSchema(filename: string): ValidateFunction {
    if (this.validators.has(filename)) {
      return this.validators.get(filename)!;
    }

    const schemaPath = resolve(this.schemasDir, filename);
    if (!existsSync(schemaPath)) {
      throw new SchemaError(`Schema file not found: ${schemaPath}`);
    }

    let schemaJson: unknown;
    try {
      const content = readFileSync(schemaPath, "utf-8");
      schemaJson = JSON.parse(content);
    } catch (err) {
      throw new SchemaError(
        `Failed to parse schema '${filename}': ${err instanceof Error ? err.message : String(err)}`
      );
    }

    let validator: ValidateFunction;
    try {
      validator = this.ajv.compile(schemaJson as object);
    } catch (err) {
      throw new SchemaError(
        `Failed to compile schema '${filename}': ${err instanceof Error ? err.message : String(err)}`
      );
    }

    this.validators.set(filename, validator);
    return validator;
  }

  /**
   * Validate data against a named schema.
   */
  validate(schemaFilename: string, data: unknown): ValidationResult {
    const validator = this.loadSchema(schemaFilename);
    const valid = validator(data) as boolean;
    return {
      valid,
      errors: valid ? undefined : (validator.errors ?? undefined),
    };
  }

  /**
   * Check if all bundled schemas are valid JSON Schema documents.
   * Returns an array of { filename, error } for any that fail.
   */
  validateAllSchemas(): Array<{ filename: string; error?: string }> {
    const results: Array<{ filename: string; error?: string }> = [];
    const schemas = this.listSchemas();

    for (const filename of schemas) {
      try {
        this.loadSchema(filename);
        results.push({ filename });
      } catch (err) {
        results.push({
          filename,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }
}

/**
 * Create a schema registry using the bundled assets.
 */
export function createSchemaRegistry(schemasDir?: string): SchemaRegistry {
  return new SchemaRegistry(schemasDir);
}
