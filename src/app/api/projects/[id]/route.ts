import { z } from "zod";
import { db } from "@/db";
import { projects, projectVersions } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { apiError, errResponse } from "@/lib/http";
import { projectFileSchema, validateProject } from "@/lib/webapp";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Every query is scoped by userId — one user can never touch another's app. */
async function owned(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const u = await requireUser();
    const { id } = await params;
    const p = await owned(u.id, id);
    if (!p) return apiError(404, "NOT_FOUND", "Project not found.");
    const versions = await db
      .select({
        id: projectVersions.id,
        label: projectVersions.label,
        createdAt: projectVersions.createdAt,
      })
      .from(projectVersions)
      .where(eq(projectVersions.projectId, id))
      .orderBy(desc(projectVersions.createdAt))
      .limit(20);
    return Response.json({
      id: p.id,
      name: p.name,
      framework: p.framework,
      entry: p.entry,
      files: p.files,
      conversationId: p.conversationId,
      updatedAt: p.updatedAt.toISOString(),
      versions: versions.map((v) => ({
        id: v.id,
        label: v.label,
        createdAt: v.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return errResponse(e);
  }
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  files: z.array(projectFileSchema).min(1).max(24).optional(),
  entry: z.string().min(3).max(96).optional(),
  /** restore a previous snapshot */
  restoreVersionId: z.string().uuid().optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const u = await requireUser();
    const { id } = await params;
    const p = await owned(u.id, id);
    if (!p) return apiError(404, "NOT_FOUND", "Project not found.");
    const body = patchSchema.parse(await req.json());

    // --- restore a snapshot -------------------------------------------------
    if (body.restoreVersionId) {
      const [v] = await db
        .select()
        .from(projectVersions)
        .where(
          and(
            eq(projectVersions.id, body.restoreVersionId),
            eq(projectVersions.projectId, id),
            eq(projectVersions.userId, u.id)
          )
        )
        .limit(1);
      if (!v) return apiError(404, "NOT_FOUND", "Version not found.");
      // snapshot the current state first so restore is itself undoable
      await db.insert(projectVersions).values({
        projectId: id,
        userId: u.id,
        label: "before restore",
        files: p.files,
        entry: p.entry,
      });
      await db
        .update(projects)
        .set({ files: v.files, entry: v.entry, updatedAt: new Date() })
        .where(eq(projects.id, id));
      return Response.json({ ok: true, files: v.files, entry: v.entry });
    }

    // --- manual edit --------------------------------------------------------
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name) set.name = body.name;
    if (body.files) {
      const check = validateProject({
        name: body.name ?? p.name,
        framework: "react",
        entry: body.entry ?? p.entry,
        files: body.files,
      });
      if (!check.ok || !check.project)
        return apiError(400, "INVALID_PROJECT", check.error ?? "Invalid project files.");
      await db.insert(projectVersions).values({
        projectId: id,
        userId: u.id,
        label: "manual edit",
        files: p.files,
        entry: p.entry,
      });
      set.files = check.project.files;
      set.entry = check.project.entry;
    } else if (body.entry) {
      set.entry = body.entry;
    }
    await db.update(projects).set(set).where(eq(projects.id, id));
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError)
      return apiError(400, "VALIDATION", e.issues.map((i) => i.message).join("; "));
    return errResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const u = await requireUser();
    const { id } = await params;
    const del = await db
      .delete(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, u.id)))
      .returning({ id: projects.id });
    if (!del.length) return apiError(404, "NOT_FOUND", "Project not found.");
    return Response.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
