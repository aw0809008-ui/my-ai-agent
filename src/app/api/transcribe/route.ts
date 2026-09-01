import { requireUser } from "@/lib/auth";
import { errResponse, apiError, limited } from "@/lib/http";
import { transcribeAudio } from "@/lib/ai-gateway";

// POST /api/transcribe — proxy audio to the self-hosted Whisper-compatible
// endpoint (STT_MODEL on the AI gateway). The browser's built-in speech
// recognition is used first; this is the server-side fallback.
export async function POST(req: Request) {
  try {
    const u = await requireUser();
    limited(`stt:${u.id}`, 20, 60_000);
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0)
      return apiError(400, "VALIDATION", "No audio received.");
    if (audio.size > 8 * 1024 * 1024)
      return apiError(413, "TOO_LARGE", "Audio clip too large.");
    try {
      const text = await transcribeAudio(audio, "voice.webm");
      return Response.json({ text });
    } catch (e) {
      return apiError(
        503,
        "STT_UNAVAILABLE",
        e instanceof Error ? e.message : "Speech-to-text is not configured."
      );
    }
  } catch (e) {
    return errResponse(e);
  }
}
