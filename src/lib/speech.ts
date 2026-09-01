// Client-side speech utilities (browser-native, no external services).

export function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function speak(
  text: string,
  opts: { rate?: number; voiceName?: string } = {}
): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const spoken = stripMarkdown(text).slice(0, 1200);
  if (!spoken) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(spoken);
  u.rate = opts.rate ?? 1;
  if (opts.voiceName) {
    const v = window.speechSynthesis
      .getVoices()
      .find((v) => v.name === opts.voiceName);
    if (v) u.voice = v;
  }
  window.speechSynthesis.speak(u);
  return true;
}

export function stopSpeech() {
  if (typeof window !== "undefined" && "speechSynthesis" in window)
    window.speechSynthesis.cancel();
}
