import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Root() {
  const u = await getAuthUser();
  if (!u) redirect("/welcome");
  if (!u.profile.onboardingDone) redirect("/onboarding");
  redirect("/home");
}
