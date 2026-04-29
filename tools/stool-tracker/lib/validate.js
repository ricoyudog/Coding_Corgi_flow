import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv from "ajv/dist/2020.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "..", "schemas", "stool-entry.schema.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

const ajv = new Ajv({ allErrors: true });
const check = ajv.compile(schema);

/** @param {{ color?: string, durationMinutes?: number }} entry */
export function validateEntry(entry) {
  const valid = check(entry);
  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors = check.errors.map((err) => {
    if (err.keyword === "enum") {
      return `${err.instancePath || "/"}: ${err.message} (${err.params.allowedValues.join(", ")})`;
    }
    return `${err.instancePath || "/"}: ${err.message}`;
  });

  return { valid: false, errors };
}
