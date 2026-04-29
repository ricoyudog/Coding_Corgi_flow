export const STOOL_COLORS = Object.freeze([
  "brown",
  "yellow",
  "green",
  "black",
  "red",
  "pale",
  "other",
]);

/** @param {{ color: string, durationMinutes: number }} input */
export function createEntry({ color, durationMinutes }) {
  return { color, durationMinutes };
}
