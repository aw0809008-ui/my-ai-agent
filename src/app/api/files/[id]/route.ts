import { db } from "@/db";
import { files } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { errResponse, apiError } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

// GET — serve the binary (image previews, downloads). Owner-only.
export async function GET(_req: Request, { params }: Params) {
  try {
    const u = await requireUser();
    const { id } = await params;
    const [f] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.userId, u.id)))
      .limit(1);
    if (!f) return apiError(404, "NOT_FOUND", "File not found.");
    return new Response(new Uint8Array(f.content), {
      headers: {
        "Content-Type": f.mime,
        "Content-Length": String(f.size),
        "Content-Disposition": `inline; filename="${encodeURIComponent(f.name)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return errResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const u = await requireUser();
    const { id } = await params;
    const del = await db
      .delete(files)
      .where(and(eq(files.id, id), eq(files.userId, u.id)))
      .returning({ id: files.id });
    if (!del.length) return apiError(404, "NOT_FOUND", "File not found.");
    return Response.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
