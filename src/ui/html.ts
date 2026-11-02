const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Readable text colour for a background, so Yellow and Pink chips stay legible. */
export function inkFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1a1a1a' : '#ffffff';
}

export function lineChip(line: { name: string; color: string }, extra = ''): string {
  return `<span class="chip ${extra}" style="--c:${line.color};--ink:${inkFor(line.color)}">${esc(line.name)}</span>`;
}
