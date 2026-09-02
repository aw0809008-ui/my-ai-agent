import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { errResponse, apiError, limited } from "@/lib/http";
import { webSearch } from "@/lib/search";

const schema = z.object({ query: z.string().trim().min(2).max(300) });

export async function POST(req: Request) {
  try {
    const u = await requireUser();
    limited(`search:${u.id}`, 15, 60_000);
    const { query } = schema.parse(await req.json());
    const { results, provider, failures } = await webSearch(query, 8);
    return Response.json({
      results,
      provider,
      // safe, sanitized explanation when nothing came back
      reason:
        results.length === 0
          ? failures.length
            ? `search providers temporarily unavailable (${failures.join(", ")})`
            : "no results found"
          : null,
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      return apiError(400, "VALIDATION", "Query must be at least 2 characters.");
    return errResponse(e);
  }
}
