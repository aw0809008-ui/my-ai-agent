// ---------------------------------------------------------------------------
// Document text extraction.
//   - TXT / MD / CSV / JSON: direct UTF-8 decode.
//   - PDF: best-effort built-in extractor (inflate FlateDecode streams, pull
//     text from Tj/TJ operators). Works for simple text PDFs; complex PDFs
//     (scanned, cmap-encoded) yield partial/no text and are reported honestly.
// ---------------------------------------------------------------------------

import zlib from "zlib";

export const TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/octet-stream",
]);

export const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const ALLOWED_MIMES = new Set([
  ...TEXT_MIMES,
  ...IMAGE_MIMES,
  "application/pdf",
]);

export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

export function extractText(buf: Buffer, mime: string, name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (TEXT_MIMES.has(mime) || ["txt", "md", "csv", "json"].includes(ext)) {
    const text = buf.toString("utf8").replace(/\0/g, "").trim();
    return text ? text.slice(0, 24_000) : null;
  }
  if (mime === "application/pdf" || ext === "pdf") {
    return extractPdfText(buf);
  }
  return null;
}

function extractPdfText(buf: Buffer): string | null {
  try {
    const raw = buf.toString("latin1");
    const out: string[] = [];
    const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let m: RegExpExecArray | null;
    let found = 0;
    while ((m = streamRe.exec(raw)) && out.join("").length < 24_000) {
      const chunk = m[1];
      let inflated: string | null = null;
      try {
        inflated = zlib.inflateSync(Buffer.from(chunk, "latin1")).toString("latin1");
      } catch {
        inflated = chunk; // uncompressed text streams
      }
      const pieces: string[] = [];
      // (… ) Tj  and  [ (…) (…) ] TJ
      const tjRe = /\(((?:\\.|[^\\()])*)\)\s*Tj/g;
      const arrRe = /\[((?:\((?:\\.|[^\\()])*\)|[^\]])*)\]\s*TJ/g;
      let t: RegExpExecArray | null;
      while ((t = tjRe.exec(inflated))) pieces.push(unescapePdf(t[1]));
      while ((t = arrRe.exec(inflated))) {
        const inner = t[1];
        const strRe = /\(((?:\\.|[^\\()])*)\)/g;
        let s: RegExpExecArray | null;
        let line = "";
        while ((s = strRe.exec(inner))) line += unescapePdf(s[1]);
        if (line) pieces.push(line);
      }
      if (pieces.length) {
        out.push(pieces.join(" "));
        found++;
      }
    }
    const text = out
      .join("\n")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 8) return null;
    return text.slice(0, 24_000);
  } catch {
    return null;
  }
}

function unescapePdf(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}
