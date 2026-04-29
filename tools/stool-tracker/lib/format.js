export function formatEntry(entry) {
  const id = entry.id ? entry.id.slice(0, 8) : "--------";
  const color = entry.color ?? "unknown";
  const duration =
    entry.durationMinutes != null ? `${entry.durationMinutes} min` : "unknown";
  const date = entry.createdAt
    ? new Date(entry.createdAt).toISOString().slice(0, 16).replace("T", " ")
    : "unknown";

  return `[${id}] ${date} | color: ${color} | duration: ${duration}`;
}

export function formatHistory(entries) {
  if (entries.length === 0) return "No entries recorded.";
  return entries.map(formatEntry).join("\n");
}
