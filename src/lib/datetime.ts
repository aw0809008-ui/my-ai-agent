// ---------------------------------------------------------------------------
// Timezone utilities + natural-language time parsing for reminders.
// Handles: "in 20 minutes", "tomorrow at 9am", "at 5pm", "on monday",
// "tonight", "this evening", "next week", "morning/afternoon/evening/night".
// ---------------------------------------------------------------------------

function tzParts(tz: string, date: Date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const out: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

function tzOffsetMs(tz: string, date: Date): number {
  const p = tzParts(tz, date);
  const asUTC = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour === 24 ? 0 : +p.hour,
    +p.minute,
    +p.second
  );
  return asUTC - date.getTime();
}

/** Build a Date (UTC instant) from wall-clock components in a timezone. */
export function zonedToUtc(
  tz: string,
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number
): Date {
  let utc = Date.UTC(y, mo - 1, d, h, mi);
  let off = tzOffsetMs(tz, new Date(utc));
  utc -= off;
  const off2 = tzOffsetMs(tz, new Date(utc));
  if (off2 !== off) utc = Date.UTC(y, mo - 1, d, h, mi) - off2;
  return new Date(utc);
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function parseHourMinute(
  raw: string | undefined
): { h: number; mi: number } | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mi = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && h <= 7) h += 12; // "at 5" most likely means 17:00
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}

export interface ParsedTime {
  dueAt: Date;
  recurrence: "none" | "daily" | "weekly";
}

/** Try to extract a due time from natural language in the user's timezone. */
export function parseNaturalTime(text: string, tz: string): ParsedTime | null {
  const t = text.toLowerCase();
  const now = new Date();
  const p = tzParts(tz, now);
  const y = +p.year;
  const mo = +p.month;
  const d = +p.day;
  const curH = (+p.hour + 24) % 24;
  const curMi = +p.minute;

  let recurrence: ParsedTime["recurrence"] = "none";
  if (/\b(every day|daily|each day|every morning|every evening)\b/.test(t))
    recurrence = "daily";
  else if (/\b(every week|weekly)\b|every (mon|tue|wed|thu|fri|sat|sun)/.test(t))
    recurrence = "weekly";

  // "in X minutes/hours/days"
  const rel = t.match(/in\s+(\d+)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\b/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    const ms =
      unit.startsWith("min") ? 60_000 : unit.startsWith("h") ? 3_600_000 : 86_400_000;
    return { dueAt: new Date(now.getTime() + n * ms), recurrence };
  }

  const timeM = t.match(
    /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)/
  );
  const hm = parseHourMinute(timeM?.[1]);

  const dayWord = t.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/
  );

  let target = new Date(Date.UTC(y, mo - 1, d, 0, 0)); // wall "today" in tz (as parts)

  const dayOfWeek = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();

  if (dayWord) {
    const want = WEEKDAYS[dayWord[1]];
    let add = (want - dayOfWeek + 7) % 7;
    if (add === 0) add = 7;
    target = new Date(target.getTime() + add * 86_400_000);
  } else if (/\btomorrow\b/.test(t) || /\bnext week\b/.test(t)) {
    target = new Date(target.getTime() + (/\bnext week\b/.test(t) ? 7 : 1) * 86_400_000);
  }

  let hh: number;
  let mm: number;
  if (hm) {
    hh = hm.h;
    mm = hm.mi;
  } else if (/\btonight\b/.test(t) || /\bnight\b/.test(t)) {
    hh = 21;
    mm = 0;
  } else if (/\bevening\b/.test(t)) {
    hh = 18;
    mm = 0;
  } else if (/\bafternoon\b/.test(t)) {
    hh = 15;
    mm = 0;
  } else if (/\bmorning\b/.test(t) || recurrence === "daily") {
    hh = 9;
    mm = 0;
  } else if (/\b(noon|midday)\b/.test(t)) {
    hh = 12;
    mm = 0;
  } else if (dayWord || /\btomorrow\b/.test(t) || /\bnext week\b/.test(t)) {
    hh = 9;
    mm = 0;
  } else {
    return null; // no recognizable time
  }

  const parts = {
    y: target.getUTCFullYear(),
    mo: target.getUTCMonth() + 1,
    d: target.getUTCDate(),
  };
  let dueAt = zonedToUtc(tz, parts.y, parts.mo, parts.d, hh, mm);

  // "at 5pm" with no day → today, or tomorrow if that time already passed
  const isToday = !dayWord && !/\b(tomorrow|next week)\b/.test(t);
  if (isToday && dueAt.getTime() <= now.getTime() + 30_000) {
    const nx = new Date(
      Date.UTC(parts.y, parts.mo - 1, parts.d) + 86_400_000
    );
    dueAt = zonedToUtc(
      tz,
      nx.getUTCFullYear(),
      nx.getUTCMonth() + 1,
      nx.getUTCDate(),
      hh,
      mm
    );
  }

  return { dueAt, recurrence };
}

export function advanceOccurrence(
  dueAt: Date,
  recurrence: "none" | "daily" | "weekly"
): Date | null {
  if (recurrence === "daily") return new Date(dueAt.getTime() + 86_400_000);
  if (recurrence === "weekly")
    return new Date(dueAt.getTime() + 7 * 86_400_000);
  return null;
}

export function formatInTz(date: Date, tz: string): string {
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(a) ===
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(b);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  if (sameDay(date, now)) return `today at ${time}`;
  if (sameDay(date, new Date(now.getTime() + 86_400_000)))
    return `tomorrow at ${time}`;
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date) + ` at ${time}`
  );
}
