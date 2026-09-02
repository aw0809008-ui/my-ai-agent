import { db } from "@/db";
import { projects } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { errResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

// GET /api/projects — the signed-in user's generated apps (metadata only).
export async function GET() {
  try {
    const u = await requireUser();
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        framework: projects.framework,
        updatedAt: projects.updatedAt,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(eq(projects.userId, u.id))
      .orderBy(desc(projects.updatedAt))
      .limit(50);
    return Response.json({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        framework: r.framework,
        updatedAt: r.updatedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return errResponse(e);
  }
}
