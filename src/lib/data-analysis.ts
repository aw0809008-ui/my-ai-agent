// ---------------------------------------------------------------------------
// Deterministic dataset profiling for CSV / JSON uploads.
//
// ANTI-FABRICATION RULE: every number surfaced to the user is COMPUTED HERE in
// Node from the actual uploaded bytes — never produced by the model. The model
// only receives this factual profile and explains it. If a statistic isn't in
// the profile, the model is told not to invent one.
// ---------------------------------------------------------------------------

export interface ColumnProfile {
  name: string;
  type: "number" | "date" | "boolean" | "text";
  nonNull: number;
  nulls: number;
  distinct: number;
  /** numeric only */
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  sum?: number;
  /** categorical only */
  topValues?: { value: string; count: number }[];
}

export interface DatasetProfile {
  rows: number;
  columns: ColumnProfile[];
  truncated: boolean;
  sample: string[][];
  header: string[];
}

const MAX_ROWS = 20_000;

/** RFC4180-ish CSV parser: quotes, escaped quotes, embedded newlines/commas. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS) break;
    } else if (c !== "\r") field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** Detect the most likely delimiter from the header line. */
function sniffDelimiter(text: string): string {
  const line = text.slice(0, 4000).split("\n")[0] ?? "";
  const counts: Record<string, number> = {
    ",": (line.match(/,/g) ?? []).length,
    ";": (line.match(/;/g) ?? []).length,
    "\t": (line.match(/\t/g) ?? []).length,
    "|": (line.match(/\|/g) ?? []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ",";
}

const NUM_RE = /^-?[\d,]*\.?\d+(?:[eE][-+]?\d+)?%?$/;

function toNumber(v: string): number | null {
  const s = v.trim().replace(/,/g, "").replace(/%$/, "").replace(/^\$/, "");
  if (!s || !NUM_RE.test(v.trim().replace(/^\$/, ""))) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isDate(v: string): boolean {
  const s = v.trim();
  if (s.length < 6 || s.length > 32) return false;
  if (!/[-/:]/.test(s)) return false;
  return !Number.isNaN(Date.parse(s));
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (!n) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(n: number): number {
  return Math.abs(n) >= 1000 ? Math.round(n * 100) / 100 : Math.round(n * 10000) / 10000;
}

/** Build a factual profile from CSV text. */
export function profileCsv(text: string): DatasetProfile | null {
  const rows = parseCsv(text, sniffDelimiter(text));
  if (rows.length < 2) return null;
  const header = rows[0].map((h, i) => h.trim() || `column_${i + 1}`);
  const body = rows.slice(1);
  const truncated = body.length >= MAX_ROWS;

  const columns: ColumnProfile[] = header.map((name, ci) => {
    const raw = body.map((r) => (r[ci] ?? "").trim());
    const present = raw.filter((v) => v !== "" && v.toLowerCase() !== "null" && v.toLowerCase() !== "na");
    const nums = present.map(toNumber).filter((n): n is number => n !== null);
    const distinct = new Set(present).size;

    const numeric = present.length > 0 && nums.length / present.length >= 0.85;
    const dateish = !numeric && present.length > 0 && present.slice(0, 50).filter(isDate).length / Math.min(present.length, 50) >= 0.8;
    const boolish =
      !numeric &&
      !dateish &&
      distinct <= 3 &&
      present.every((v) => /^(true|false|yes|no|0|1|y|n)$/i.test(v));

    const base: ColumnProfile = {
      name,
      type: numeric ? "number" : dateish ? "date" : boolish ? "boolean" : "text",
      nonNull: present.length,
      nulls: raw.length - present.length,
      distinct,
    };

    if (numeric && nums.length) {
      const sorted = [...nums].sort((a, b) => a - b);
      const sum = nums.reduce((s, n) => s + n, 0);
      base.min = round(sorted[0]);
      base.max = round(sorted[sorted.length - 1]);
      base.mean = round(sum / nums.length);
      base.median = round(median(sorted));
      base.sum = round(sum);
    } else if (present.length) {
      const freq = new Map<string, number>();
      for (const v of present) freq.set(v, (freq.get(v) ?? 0) + 1);
      base.topValues = [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value: value.slice(0, 60), count }));
    }
    return base;
  });

  return {
    rows: body.length,
    columns,
    truncated,
    header,
    sample: body.slice(0, 5).map((r) => r.slice(0, header.length)),
  };
}

/** Profile a JSON array of flat objects by projecting it to CSV-like columns. */
export function profileJson(text: string): DatasetProfile | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const arr = Array.isArray(data)
    ? data
    : typeof data === "object" && data !== null
      ? (Object.values(data).find((v) => Array.isArray(v)) as unknown[] | undefined)
      : undefined;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const objects = arr.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
  if (!objects.length) return null;

  const keys: string[] = [];
  for (const o of objects.slice(0, 200))
    for (const k of Object.keys(o)) if (!keys.includes(k) && keys.length < 40) keys.push(k);

  const lines = [
    keys.join(","),
    ...objects.slice(0, MAX_ROWS).map((o) =>
      keys
        .map((k) => {
          const v = o[k];
          const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    ),
  ];
  return profileCsv(lines.join("\n"));
}

export function profileDataset(text: string, filename: string): DatasetProfile | null {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "json") return profileJson(text) ?? profileCsv(text);
  return profileCsv(text) ?? profileJson(text);
}

/** Render the profile as compact, factual context for the model. */
export function formatProfile(p: DatasetProfile, filename: string): string {
  const cols = p.columns
    .map((c) => {
      const bits = [`type=${c.type}`, `non-null=${c.nonNull}`, `nulls=${c.nulls}`, `distinct=${c.distinct}`];
      if (c.type === "number")
        bits.push(`min=${c.min}`, `max=${c.max}`, `mean=${c.mean}`, `median=${c.median}`, `sum=${c.sum}`);
      else if (c.topValues?.length)
        bits.push(`top=[${c.topValues.map((t) => `${t.value}×${t.count}`).join(", ")}]`);
      return `- ${c.name}: ${bits.join(", ")}`;
    })
    .join("\n");

  const sample = [p.header.join(" | "), ...p.sample.map((r) => r.join(" | "))].join("\n");

  return `Dataset profile for "${filename}" (computed exactly from the uploaded file${
    p.truncated ? `, first ${p.rows} rows` : ""
  }):

Rows: ${p.rows}
Columns: ${p.columns.length}

${cols}

First rows:
${sample}

IMPORTANT: these statistics were computed from the real file. Use ONLY these numbers. Do not invent additional statistics, correlations or totals that are not listed above — if the user asks for something not covered, say what extra computation would be required.`;
}
