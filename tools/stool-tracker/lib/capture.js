import * as readline from "node:readline/promises";
import { STOOL_COLORS } from "./entry.js";
import { saveEntry } from "./store.js";

/**
 * @param {string} storePath
 * @param {{ input?: import("node:stream").Readable, output?: import("node:stream").Writable }} [opts]
 * @returns {Promise<{ saved: boolean, record?: object, errors?: string[] }>}
 */
export async function captureObservation(storePath, opts = {}) {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;

  const rl = readline.createInterface({ input, output });
  try {
    output.write(`Available colors: ${STOOL_COLORS.join(", ")}\n`);
    const color = (await rl.question("Stool color: ")).trim();
    const durationStr = (await rl.question("Duration (minutes): ")).trim();
    const durationMinutes = Number(durationStr);

    return saveEntry({ color, durationMinutes }, storePath);
  } finally {
    rl.close();
  }
}
