import { cookies } from "next/headers";
import { destroySession, getSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { errResponse } from "@/lib/http";

export async function POST() {
  try {
    // destroy whichever session presented itself (cookie or bearer)
    const token = await getSessionToken();
    if (token) await destroySession(token);
    (await cookies()).delete(SESSION_COOKIE);
    return Response.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
