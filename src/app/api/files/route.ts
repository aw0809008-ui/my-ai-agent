import { db } from "@/db";
import { files } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { errResponse, apiError, limited, logEvent } from "@/lib/http";
import { ALLOWED_MIMES, IMAGE_MIMES, MAX_FILE_BYTES, extractText } from "@/lib/extract";
import { lexicalEmbedding } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

function isAllowed(mime: string, name: string): boolean {
  if (ALLOWED_MIMES.has(mime)) return true;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ["txt", "md", "csv", "json", "pdf", "png", "jpg", "jpeg", "webp"].includes(ext);
}

// GET /api/files — list the user's files (no binary content).
export async function GET() {
  try {
    const u = await requireUser();
    const rows = await db
      .select({
        id: files.id,
        name: files.name,
        mime: files.mime,
        size: files.size,
        hasText: files.extractedText,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(eq(files.userId, u.id))
      .orderBy(desc(files.createdAt))
      .limit(50);
    return Response.json({
      items: rows.map((f) => ({
        id: f.id,
        name: f.name,
        mime: f.mime,
        size: f.size,
        hasText: Boolean(f.hasText),
        isImage: IMAGE_MIMES.has(f.mime),
        createdAt: f.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return errResponse(e);
  }
}

// POST /api/files — multipart upload (field "file").
export async function POST(req: Request) {
  try {
    const u = await requireUser();
    limited(`upload:${u.id}`, 20, 60_000);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      return apiError(400, "VALIDATION", "Attach a file in the 'file' field.");
    if (file.size > MAX_FILE_BYTES)
      return apiError(413, "TOO_LARGE", "Files are limited to 2 MB.");
    const mime = file.type || "application/octet-stream";
    if (!isAllowed(mime, file.name))
      return apiError(
        415,
        "UNSUPPORTED_TYPE",
        "Allowed types: TXT, MD, CSV, JSON, PDF, PNG, JPG, WEBP."
      );

    const buf = Buffer.from(await file.arrayBuffer());
    const extracted = extractText(buf, mime, file.name);
    const embedding = extracted ? lexicalEmbedding(extracted.slice(0, 4000)) : null;

    const [row] = await db
      .insert(files)
      .values({
        userId: u.id,
        name: file.name.slice(0, 200),
        mime,
        size: file.size,
        content: buf,
        extractedText: extracted,
        embedding,
      })
      .returning({ id: files.id });
    logEvent({ msg: "file_uploaded", userId: u.id, size: file.size, mime });
    return Response.json({
      id: row.id,
      name: file.name,
      mime,
      size: file.size,
      hasText: Boolean(extracted),
      isImage: IMAGE_MIMES.has(mime),
    });
  } catch (e) {
    return errResponse(e);
  }
}
