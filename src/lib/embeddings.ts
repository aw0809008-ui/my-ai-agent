// ---------------------------------------------------------------------------
// Built-in sparse lexical embeddings.
//
// Real retrieval technique (hashed unigram+bigram term vectors, L2-normalized)
// that works with zero external dependencies and zero GPU. The AI gateway can
// replace this with a self-hosted neural embedding model when AI_BASE_URL is
// configured — see src/lib/ai-gateway.ts (embedText).
// ---------------------------------------------------------------------------

const DIMS = 512;

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function lexicalEmbedding(text: string): number[] {
  const vec = new Array<number>(DIMS).fill(0);
  const tokens = tokenize(text).slice(0, 400);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    vec[fnv1a("u:" + t) % DIMS] += 1;
    // character trigram signal for fuzzy matching
    for (let j = 0; j + 2 < t.length; j += 2) {
      vec[fnv1a("t:" + t.slice(j, j + 3)) % DIMS] += 0.35;
    }
    if (i + 1 < tokens.length) {
      vec[fnv1a("b:" + t + " " + tokens[i + 1]) % DIMS] += 0.8;
    }
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function topK<T extends { embedding?: number[] | null }>(
  items: T[],
  queryEmbedding: number[],
  k: number,
  minScore = 0.1
): { item: T; score: number }[] {
  return items
    .map((item) => ({
      item,
      score: item.embedding ? cosine(queryEmbedding, item.embedding) : 0,
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
