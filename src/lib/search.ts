// ---------------------------------------------------------------------------
// Web search provider chain — keyless, self-host-friendly.
//
// Order: SearXNG (self-hosted, most reliable) → DuckDuckGo HTML → DuckDuckGo
// Lite → Mojeek → Bing. DuckDuckGo frequently blocks/challenges datacenter
// IPs (anomaly pages, HTTP 202, zero result blocks), so every provider
// reports a SANITIZED failure reason to the server log instead of failing
// silently. Set SEARXNG_URL for dependable production search.
//
// Each provider can be disabled via env for ops debugging:
//   SEARCH_DISABLE_DDG / SEARCH_DISABLE_DDG_LITE / SEARCH_DISABLE_MOJEEK / SEARCH_DISABLE_BING (=1)
// ---------------------------------------------------------------------------

import { logEvent } from "@/lib/http";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string; // domain
}

export interface SearchOutcome {
  results: SearchResult[];
  provider: string | null;
  /** sanitized per-provider failure notes, server-log + safe user hint */
  failures: string[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Keep only valid http/https URLs, strip DDG redirect wrappers, dedupe. */
function normalizeResults(raw: SearchResult[], limit: number): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of raw) {
    let url = r.url;
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        url = decodeURIComponent(uddg[1]);
      } catch {
        continue;
      }
    }
    let host = "";
    try {
      const u = new URL(/^https?:\/\//.test(url) ? url : `https:${url.startsWith("//") ? url : ""}`);
      if (!/^https?:$/.test(u.protocol)) continue;
      host = u.hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    const title = r.title.replace(/[\u0000-\u001f]/g, "").slice(0, 200).trim();
    if (!title) continue;
    const key = `${host}${new URL(url).pathname}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      url,
      snippet: r.snippet.replace(/[\u0000-\u001f]/g, "").slice(0, 320),
      source: host,
    });
    if (out.length >= limit) break;
  }
  return out;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type ProviderFn = (query: string, limit: number) => Promise<SearchResult[]>;

interface ProviderDef {
  name: string;
  enabled: () => boolean;
  fn: ProviderFn;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

const searxng: ProviderFn = async (query, limit) => {
  const base = process.env.SEARXNG_URL;
  if (!base) return [];
  const url = `${base.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json&safesearch=1`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(7000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw Object.assign(new Error(`searxng http ${res.status}`), { status: res.status });
  const json = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };
  return (json.results ?? [])
    .filter((r) => r.title && r.url)
    .map((r) => ({
      title: r.title!.trim(),
      url: r.url!,
      snippet: (r.content ?? "").trim().slice(0, 320),
      source: hostOf(r.url!),
    }));
};

const ddgHtml: ProviderFn = async (query, _limit) => {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw Object.assign(new Error(`ddg-html http ${res.status}`), { status: res.status });
  const html = await res.text();
  const results: SearchResult[] = [];
  const blocks = html.split(/class="result results_links/);
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const linkM = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkM) continue;
    const snipM = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    results.push({
      title: stripTags(linkM[2]),
      url: decodeEntities(linkM[1]),
      snippet: snipM ? stripTags(snipM[1]) : "",
      source: "",
    });
  }
  // HTTP 202 anomaly/challenge pages return ~0 result blocks
  if (results.length === 0) throw new Error("ddg-html 0 blocks (challenged?)");
  return results;
};

const ddgLite: ProviderFn = async (query, _limit) => {
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw Object.assign(new Error(`ddg-lite http ${res.status}`), { status: res.status });
  const html = await res.text();
  const results: SearchResult[] = [];
  const linkRe = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snips = [...html.matchAll(/<td class="result-snippet">([\s\S]*?)<\/td>/g)].map((m) =>
    stripTags(m[1])
  );
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    results.push({
      title: stripTags(m[2]),
      url: decodeEntities(m[1]),
      snippet: snips[i] ?? "",
      source: "",
    });
    i++;
  }
  if (results.length === 0) throw new Error("ddg-lite 0 blocks");
  return results;
};

const mojeek: ProviderFn = async (query, _limit) => {
  const res = await fetch(`https://www.mojeek.com/search?q=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw Object.assign(new Error(`mojeek http ${res.status}`), { status: res.status });
  const html = await res.text();
  const results: SearchResult[] = [];
  const itemRe = /<a class="title" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p class="s">([\s\S]*?)<\/p>)?/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(html))) {
    results.push({
      title: stripTags(m[2]),
      url: decodeEntities(m[1]),
      snippet: m[3] ? stripTags(m[3]) : "",
      source: "",
    });
  }
  if (results.length === 0) throw new Error("mojeek 0 blocks");
  return results;
};

/** Resolve Bing /ck/a redirect links: destination is base64url in `u=` (with an
 *  a1/a2 prefix). Returns null for undecodable tracking links. */
function decodeBingUrl(raw: string): string | null {
  try {
    const u = new URL(/^https?:\/\//.test(raw) ? raw : `https:${raw}`);
    if (u.hostname.endsWith("bing.com") && u.pathname.startsWith("/ck/")) {
      const dest = u.searchParams.get("u");
      if (!dest || dest.length < 4) return null;
      const s = dest.startsWith("a1") || dest.startsWith("a2") ? dest.slice(2) : dest;
      const decoded = Buffer.from(
        s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4),
        "base64"
      ).toString("utf8");
      return /^https?:\/\//.test(decoded) ? decoded : null;
    }
    return raw;
  } catch {
    return null;
  }
}

const bing: ProviderFn = async (query, _limit) => {
  const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`, {
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw Object.assign(new Error(`bing http ${res.status}`), { status: res.status });
  const html = await res.text();
  const results: SearchResult[] = [];
  const h2Re = /<h2[^>]*>([\s\S]*?)<\/h2>/g;
  let m: RegExpExecArray | null;
  while ((m = h2Re.exec(html))) {
    const linkM = m[1].match(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkM) continue;
    const url = decodeBingUrl(decodeEntities(linkM[1]));
    const title = stripTags(linkM[2]);
    if (!url || !title) continue;
    results.push({ title, url, snippet: "", source: "" });
  }
  // result captions appear as b_lineclamp paragraphs in the same order
  const caps = [...html.matchAll(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/g)].map((c) =>
    stripTags(c[1])
  );
  results.forEach((r, i) => {
    if (caps[i]) r.snippet = caps[i];
  });
  if (results.length === 0) throw new Error("bing 0 blocks");
  return results;
};

function disabled(name: string): boolean {
  return process.env[`SEARCH_DISABLE_${name}`] === "1";
}

const providers: ProviderDef[] = [
  { name: "searxng", enabled: () => Boolean(process.env.SEARXNG_URL), fn: searxng },
  { name: "ddg-html", enabled: () => !disabled("DDG"), fn: ddgHtml },
  { name: "ddg-lite", enabled: () => !disabled("DDG_LITE"), fn: ddgLite },
  { name: "mojeek", enabled: () => !disabled("MOJEEK"), fn: mojeek },
  { name: "bing", enabled: () => !disabled("BING"), fn: bing },
];

// ---------------------------------------------------------------------------
// Chain executor — logs sanitized provider failures, returns first good page
// ---------------------------------------------------------------------------

export async function webSearch(query: string, limit = 6): Promise<SearchOutcome> {
  const failures: string[] = [];
  const start = Date.now();
  for (const p of providers) {
    if (!p.enabled()) continue;
    try {
      const raw = await p.fn(query, limit * 2);
      const results = normalizeResults(raw, limit);
      if (results.length > 0) {
        logEvent({
          msg: "web_search",
          provider: p.name,
          hits: results.length,
          ms: Date.now() - start,
          qLen: query.length,
        });
        return { results, provider: p.name, failures };
      }
      failures.push(`${p.name}:empty`);
    } catch (e) {
      const status = (e as { status?: number }).status;
      failures.push(`${p.name}:${status ?? "err"}`);
    }
  }
  logEvent({
    msg: "web_search_exhausted",
    failures,
    ms: Date.now() - start,
    qLen: query.length,
  });
  return { results: [], provider: null, failures };
}

// ---------------------------------------------------------------------------
// Research mode — multi-query search, cross-provider dedupe, content extraction
// ---------------------------------------------------------------------------

export interface ResearchSource extends SearchResult {
  /** extracted page text (empty when the page could not be read) */
  excerpt: string;
}

export interface ResearchOutcome {
  sources: ResearchSource[];
  queries: string[];
  provider: string | null;
  failures: string[];
}

/** Build a few angle variations so we don't rely on a single phrasing. */
export function researchQueries(topic: string): string[] {
  const base = topic.replace(/^(research|deep dive into|investigate|find out about)\s+/i, "").trim();
  const short = base.split(/\s+/).slice(0, 10).join(" ");
  const out = [base];
  if (!/\b20\d\d\b/.test(base)) out.push(`${short} ${new Date().getFullYear()}`);
  out.push(`${short} comparison OR review OR analysis`);
  return [...new Set(out)].slice(0, 3);
}

/**
 * Run several searches, merge and dedupe by domain+path, then fetch readable
 * text from the top results so the model can synthesise from real content
 * rather than snippets alone.
 */
export async function research(
  topic: string,
  opts: { maxSources?: number; fetchPages?: number } = {}
): Promise<ResearchOutcome> {
  const maxSources = opts.maxSources ?? 8;
  const fetchPages = opts.fetchPages ?? 4;
  const queries = researchQueries(topic);
  const failures: string[] = [];
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  let provider: string | null = null;

  for (const q of queries) {
    const r = await webSearch(q, 6);
    if (r.provider && !provider) provider = r.provider;
    failures.push(...r.failures);
    for (const item of r.results) {
      let key = item.source;
      try {
        key = `${new URL(item.url).hostname}${new URL(item.url).pathname}`.toLowerCase();
      } catch {
        /* keep domain key */
      }
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    if (merged.length >= maxSources) break;
  }

  const top = merged.slice(0, maxSources);
  // fetch page bodies for the first few sources, in parallel, best-effort
  const texts = await Promise.all(
    top.slice(0, fetchPages).map((s) => fetchPageText(s.url, 1800).catch(() => ""))
  );

  const sources: ResearchSource[] = top.map((s, i) => ({
    ...s,
    excerpt: (texts[i] ?? "").trim(),
  }));

  logEvent({
    msg: "research_done",
    queries: queries.length,
    sources: sources.length,
    withContent: sources.filter((s) => s.excerpt.length > 200).length,
    provider,
  });

  return { sources, queries, provider, failures: [...new Set(failures)] };
}

/** Fetch readable text content from a page (for search synthesis). */
export async function fetchPageText(url: string, maxChars = 1600): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return "";
    const html = await res.text();
    const mainM =
      html.match(/<article[\s\S]*?<\/article>/i) ?? html.match(/<main[\s\S]*?<\/main>/i);
    return stripTags(mainM ? mainM[0] : html).slice(0, maxChars);
  } catch {
    return "";
  }
}
