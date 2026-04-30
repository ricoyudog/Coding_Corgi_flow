import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { SchemaRegistry, SchemaError, createSchemaRegistry } from "../src/lib/schemas.js";

const TEST_DIR = resolve(tmpdir(), "corgispec-schema-test-" + Date.now());

const VALID_SCHEMA = JSON.stringify({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string" },
    age: { type: "number" },
  },
});

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("SchemaRegistry", () => {
  describe("listSchemas", () => {
    it("returns empty array when no schemas dir", () => {
      const registry = new SchemaRegistry("/nonexistent/path");
      expect(registry.listSchemas()).toEqual([]);
    });

    it("lists .json files in schemas directory", () => {
      writeFileSync(resolve(TEST_DIR, "one.json"), "{}");
      writeFileSync(resolve(TEST_DIR, "two.json"), "{}");
      writeFileSync(resolve(TEST_DIR, "readme.md"), "not a schema");

      const registry = new SchemaRegistry(TEST_DIR);
      const schemas = registry.listSchemas();
      expect(schemas).toContain("one.json");
      expect(schemas).toContain("two.json");
      expect(schemas).not.toContain("readme.md");
    });
  });

  describe("loadSchema", () => {
    it("loads and compiles a valid JSON Schema", () => {
      writeFileSync(resolve(TEST_DIR, "test.json"), VALID_SCHEMA);

      const registry = new SchemaRegistry(TEST_DIR);
      const validator = registry.loadSchema("test.json");
      expect(typeof validator).toBe("function");
    });

    it("caches compiled schemas", () => {
      writeFileSync(resolve(TEST_DIR, "test.json"), VALID_SCHEMA);

      const registry = new SchemaRegistry(TEST_DIR);
      const v1 = registry.loadSchema("test.json");
      const v2 = registry.loadSchema("test.json");
      expect(v1).toBe(v2);
    });

    it("throws SchemaError for missing file", () => {
      const registry = new SchemaRegistry(TEST_DIR);
      expect(() => registry.loadSchema("missing.json")).toThrow(SchemaError);
      expect(() => registry.loadSchema("missing.json")).toThrow("Schema file not found");
    });

    it("throws SchemaError for invalid JSON", () => {
      writeFileSync(resolve(TEST_DIR, "bad.json"), "{ not valid json");

      const registry = new SchemaRegistry(TEST_DIR);
      expect(() => registry.loadSchema("bad.json")).toThrow(SchemaError);
      expect(() => registry.loadSchema("bad.json")).toThrow("Failed to parse schema");
    });
  });

  describe("validate", () => {
    it("returns valid: true for matching data", () => {
      writeFileSync(resolve(TEST_DIR, "test.json"), VALID_SCHEMA);

      const registry = new SchemaRegistry(TEST_DIR);
      const result = registry.validate("test.json", { name: "test", age: 25 });
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("returns valid: false with errors for non-matching data", () => {
      writeFileSync(resolve(TEST_DIR, "test.json"), VALID_SCHEMA);

      const registry = new SchemaRegistry(TEST_DIR);
      const result = registry.validate("test.json", { age: "not a number" });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("detects missing required fields", () => {
      writeFileSync(resolve(TEST_DIR, "test.json"), VALID_SCHEMA);

      const registry = new SchemaRegistry(TEST_DIR);
      const result = registry.validate("test.json", {});
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.keyword === "required")).toBe(true);
    });
  });

  describe("validateAllSchemas", () => {
    it("returns results for all schema files", () => {
      writeFileSync(resolve(TEST_DIR, "valid.json"), VALID_SCHEMA);
      writeFileSync(resolve(TEST_DIR, "invalid.json"), "{ broken json");

      const registry = new SchemaRegistry(TEST_DIR);
      const results = registry.validateAllSchemas();
      expect(results.length).toBe(2);

      const valid = results.find((r) => r.filename === "valid.json");
      expect(valid).toBeDefined();
      expect(valid!.error).toBeUndefined();

      const invalid = results.find((r) => r.filename === "invalid.json");
      expect(invalid).toBeDefined();
      expect(invalid!.error).toBeDefined();
    });

    it("returns empty array when no schemas exist", () => {
      const registry = new SchemaRegistry("/nonexistent");
      const results = registry.validateAllSchemas();
      expect(results).toEqual([]);
    });
  });
});

describe("createSchemaRegistry", () => {
  it("creates a registry with custom path", () => {
    writeFileSync(resolve(TEST_DIR, "test.json"), VALID_SCHEMA);
    const registry = createSchemaRegistry(TEST_DIR);
    expect(registry.listSchemas()).toContain("test.json");
  });
});
