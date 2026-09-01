// ---------------------------------------------------------------------------
// Web search abstraction. Providers (in priority order):
//   1. SearXNG — self-hosted metasearch (SEARXNG_URL env). Fully private.
//   2. DuckDuckGo HTML — keyless fallback, server-side fetch + parse.
// No proprietary AI/search APIs are required. Optional page-fetch enrichment
// pulls readable text from top results for synthesis.
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string; // engine/provider
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

async function searxng(query: string, limit: number): Promise<SearchResult[]> {
  const base = process.env.SEARXNG_URL;
  if (!base) return [];
  const url = `${base.replace(/\/$/, "")}/search?q=${encodeURIComponent(
    query
  )}&format=json&safesearch=1`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(7000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string; engine?: string }[];
  };
  return (json.results ?? [])
    .filter((r) => r.title && r.url)
    .slice(0, limit)
    .map((r) => ({
      title: r.title!.trim(),
      url: r.url!,
      snippet: (r.content ?? "").trim().slice(0, 300),
      source: hostOf(r.url!),
    }));
}

async function duckduckgo(query: string, limit: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      Accept: "text/html",
    },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const results: SearchResult[] = [];
  const blocks = html.split(/class="result results_links/);
  for (let i = 1; i < blocks.length && results.length < limit; i++) {
    const b = blocks[i];
    const linkM = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkM) continue;
    let href = decodeEntities(linkM[1]);
    // ddg redirect links wrap the real URL in ?uddg=
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (!/^https?:\/\//.test(href)) continue;
    const title = stripTags(linkM[2]);
    const snipM = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = snipM ? stripTags(snipM[1]).slice(0, 300) : "";
    results.push({ title, url: href, snippet, source: hostOf(href) });
  }
  return results;
}

export async function webSearch(
  query: string,
  limit = 6
): Promise<{ results: SearchResult[]; provider: string }> {
  const sx = await searxng(query, limit).catch(() => []);
  if (sx.length) return { results: sx, provider: "searxng (self-hosted)" };
  const ddg = await duckduckgo(query, limit).catch(() => []);
  return { results: ddg, provider: "duckduckgo" };
}

/** Fetch readable text content from a page (for search synthesis). */
export async function fetchPageText(url: string, maxChars = 1600): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
      redirect: "follow",
    });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return "";
    const html = await res.text();
    // prefer main/article content when identifiable
    const mainM =
      html.match(/<article[\s\S]*?<\/article>/i) ??
      html.match(/<main[\s\S]*?<\/main>/i);
    return stripTags(mainM ? mainM[0] : html).slice(0, maxChars);
  } catch {
    return "";
  }
}
