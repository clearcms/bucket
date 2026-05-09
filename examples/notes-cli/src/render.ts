/**
 * Tiny ANSI helpers + table renderer. No external deps.
 *
 * Colours are skipped automatically when stdout is not a TTY or when
 * NO_COLOR is set, so piping into a file gives clean text.
 */

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;

function wrap(code: string, s: string): string {
  return useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export const c = {
  bold: (s: string) => wrap("1", s),
  dim: (s: string) => wrap("2", s),
  red: (s: string) => wrap("31", s),
  green: (s: string) => wrap("32", s),
  yellow: (s: string) => wrap("33", s),
  blue: (s: string) => wrap("34", s),
  magenta: (s: string) => wrap("35", s),
  cyan: (s: string) => wrap("36", s),
};

/** Visible width of a string (strips ANSI escapes for column math). */
function visibleWidth(s: string): number {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function pad(s: string, width: number): string {
  const w = visibleWidth(s);
  if (w >= width) return s;
  return s + " ".repeat(width - w);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return `${s.slice(0, max - 1)}…`;
}

export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(visibleWidth(h), ...rows.map((r) => visibleWidth(r[i] ?? ""))),
  );
  const fmt = (cells: string[]) => cells.map((cell, i) => pad(cell, widths[i] ?? 0)).join("  ");
  const head = c.bold(fmt(headers));
  const sep = c.dim(widths.map((w) => "─".repeat(w)).join("  "));
  const body = rows.map((r) => fmt(r)).join("\n");
  return [head, sep, body].filter(Boolean).join("\n");
}

export function shortTitle(title: string, max = 40): string {
  return truncate(title, max);
}

export function shortId(id: string): string {
  // ULIDs are 26 chars; show last 8 for readable lookup. The CLI accepts
  // either the full id or the short suffix.
  return id.slice(-8);
}

export function formatTags(tags: readonly string[]): string {
  if (tags.length === 0) return c.dim("—");
  return tags.map((t) => c.cyan(`#${t}`)).join(" ");
}

export function formatTime(iso: string): string {
  // Compact local time: 2026-05-09 14:23
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
