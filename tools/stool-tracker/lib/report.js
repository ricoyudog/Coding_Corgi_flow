/**
 * @param {object[]} entries
 * @returns {{ count: number, colorBreakdown: Record<string, number>, avgDurationMinutes: number | null, text: string }}
 */
export function generateReport(entries) {
  if (entries.length === 0) {
    return {
      count: 0,
      colorBreakdown: {},
      avgDurationMinutes: null,
      text: "No entries to report.",
    };
  }

  const colorBreakdown = {};
  let totalDuration = 0;
  let durationCount = 0;

  for (const e of entries) {
    const c = e.color ?? "unknown";
    colorBreakdown[c] = (colorBreakdown[c] || 0) + 1;
    if (e.durationMinutes != null) {
      totalDuration += e.durationMinutes;
      durationCount++;
    }
  }

  const avgDurationMinutes =
    durationCount > 0 ? Math.round(totalDuration / durationCount) : null;

  const sorted = Object.entries(colorBreakdown).sort((a, b) => b[1] - a[1]);

  let text = `Stool Report (${entries.length} entries)\n`;
  text += "\u2500".repeat(40) + "\n";
  text += "Color breakdown:\n";
  for (const [color, count] of sorted) {
    text += `  ${color}: ${count}\n`;
  }
  text += `Average duration: ${avgDurationMinutes != null ? avgDurationMinutes + " min" : "N/A"}\n`;

  return { count: entries.length, colorBreakdown, avgDurationMinutes, text };
}
