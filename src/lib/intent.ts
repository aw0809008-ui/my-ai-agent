// ---------------------------------------------------------------------------
// Local intent router ("small model path" of the model router).
//
// Deterministic command parsing for explicit tool intents — reminders, memory,
// notes, web search — so these work instantly, cost zero GPU tokens, and keep
// functioning even when the LLM server is offline. Everything else falls
// through to the self-hosted LLM.
// ---------------------------------------------------------------------------

export interface IntentCall {
  tool: string;
  args: Record<string, unknown>;
  label: string; // short human label for the UI chip
}

/**
 * Detect a text-to-image GENERATION request.
 *
 * Deliberately conservative and separate from image UNDERSTANDING:
 *  - callers must pass hasImageAttachment; when an image is attached the user
 *    is asking ABOUT that image, so generation never fires.
 *  - requires a creation verb AND an image noun ("draw a cat" also counts).
 *  - explicit analysis verbs (describe/analyse/read/what is…) are excluded.
 *
 * Returns the cleaned image prompt, or null when this isn't a generation ask.
 */
export function detectImageGeneration(
  raw: string,
  hasImageAttachment: boolean
): string | null {
  if (hasImageAttachment) return null; // → vision route, never generation
  const text = raw.trim();
  const t = text.toLowerCase();
  if (t.length < 4 || text.length > 1500) return null;

  // asking about an existing/looked-at image → understanding, not generation
  if (/\b(what|describe|analy[sz]e|explain|read|identify|caption|ocr)\b[^.?!]{0,40}\b(this|that|the|my|attached|uploaded)\s+(image|picture|photo|screenshot|chart)\b/.test(t))
    return null;

  const IMAGE_NOUN =
    String.raw`(?:image|picture|photo(?:graph)?|illustration|drawing|artwork|art|logo|icon|poster|thumbnail|wallpaper|avatar|sketch|painting|render(?:ing)?|graphic|banner|mockup)`;
  const CREATE_VERB = String.raw`(?:create|generate|make|draw|design|render|produce|paint|sketch|illustrate|imagine)`;

  // "create an image of X" / "generate a logo for X" / "make me a poster showing X"
  const m1 = t.match(
    new RegExp(
      String.raw`^(?:please\s+|can you\s+|could you\s+|i want you to\s+|i need\s+)*${CREATE_VERB}\s+(?:me\s+)?(?:an?\s+|some\s+|the\s+)?(?:\w+\s+){0,3}?${IMAGE_NOUN}\b\s*(?:of|showing|with|for|depicting|that shows|about)?\s*([\s\S]*)$`,
      "i"
    )
  );
  if (m1) {
    const subject = m1[1].trim().replace(/^[:,\-–—]\s*/, "");
    // keep the whole original phrasing as the prompt — style words matter
    return subject.length >= 2 ? text.replace(/^\s*(please|can you|could you)\s+/i, "").trim() : null;
  }

  // "draw a cartoon elephant" — verb + subject, image noun implied by draw/paint/sketch
  const m2 = t.match(
    new RegExp(`^(?:please\\s+)?(?:draw|paint|sketch|illustrate)\\s+(?:me\\s+)?(?:an?\\s+|the\\s+)?([\\s\\S]{2,})$`, "i")
  );
  if (m2) return text.replace(/^\s*please\s+/i, "").trim();

  // "generate a cartoon elephant" — create verb + a visual style/medium word.
  // App nouns are excluded first so "create a note/reminder/task" never fires.
  const APP_NOUN =
    /\b(note|notes|reminder|reminders|task|tasks|memory|memories|list|account|password|conversation|chat|summary|plan|schedule|file|folder|report|email|message|function|script|component|api|endpoint|table|query|test|readme)\b/;
  const STYLE_WORD =
    /\b(cartoon|realistic|photorealistic|photo-?real|3d|anime|manga|watercolou?r|oil painting|pixel art|pixel-art|minimalist|futuristic|surreal|abstract|isometric|low-?poly|sci-?fi|fantasy|vintage|retro|cyberpunk|steampunk|comic|caricature|portrait|landscape|silhouette|neon|vector|flat design|line art|concept art|digital art|studio lighting|cinematic)\b/;
  const m3 = t.match(
    new RegExp(`^(?:please\\s+)?(?:${CREATE_VERB})\\s+(?:me\\s+)?(?:an?\\s+|some\\s+|the\\s+)?([\\s\\S]{2,})$`, "i")
  );
  if (m3 && !APP_NOUN.test(t) && STYLE_WORD.test(t)) {
    return text.replace(/^\s*please\s+/i, "").trim();
  }

  // "an image of X, please" style trailing form
  if (new RegExp(String.raw`^${IMAGE_NOUN}\s+of\s+[\s\S]{2,}$`, "i").test(t)) return text;

  return null;
}

const TIME = String.raw`(?:at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?(?:\s+(?:today|tomorrow|tonight|morning|evening|afternoon|night))?|tomorrow(?:\s+(?:morning|evening|afternoon|night))?(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)?|tonight|today|this\s+(?:morning|evening|afternoon)|in\s+\d+\s*(?:minutes?|mins?|hours?|hrs?|days?)|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)?|next\s+week|every\s+(?:day|morning|evening|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)?)`;
const TIME_AT_END = new RegExp(`^([\\s\\S]*?)\\s+(${TIME})[.,!?\\s]*$`, "i");
const TIME_AT_START = new RegExp(`^(${TIME})[.,!?\\s]*\\s+(?:to\\s+)?([\\s\\S]+)$`, "i");

/**
 * Detect a DEEP RESEARCH request (multi-source, comparison, report) as opposed
 * to a quick lookup. Plain "search the web for X" stays on the fast path.
 */
export function detectResearch(raw: string): string | null {
  const text = raw.trim();
  if (text.length < 12 || text.length > 2000) return null;
  const t = text.toLowerCase();

  const RESEARCH_VERB =
    /\b(research|deep[- ]?dive|investigate|market research|competitor analysis|write (?:me )?a report|in[- ]depth (?:look|analysis|report)|comprehensive (?:overview|analysis|report)|literature review)\b/;
  const COMPARE =
    /\b(compare|comparison|versus|\bvs\.?\b|pros and cons|which is better|alternatives to)\b/;

  if (RESEARCH_VERB.test(t)) return text;
  if (COMPARE.test(t) && text.split(/\s+/).length >= 5) return text;
  return null;
}

export function routeIntent(raw: string): IntentCall | null {
  const text = raw.trim();
  const t = text.toLowerCase();

  // --- Reminders -----------------------------------------------------------
  const rem = t.match(/^(?:please\s+)?remind\s+me\s+(?:to\s+)?([\s\S]+)$/);
  if (rem) {
    const full = rem[1].trim();
    let task: string;
    let when: string;
    const endM = full.match(TIME_AT_END);
    const startM = endM ? null : full.match(TIME_AT_START);
    if (endM) {
      task = endM[1].replace(/^(?:to\s+)/, "").replace(/[.,!?\s]+$/, "");
      when = endM[2];
    } else if (startM) {
      when = startM[1];
      task = startM[2].replace(/^(?:to\s+)/, "").replace(/[.,!?\s]+$/, "");
    } else {
      task = full.replace(/[.,!?\s]+$/, "");
      when = "tomorrow";
    }
    if (task.length >= 2) {
      const rec = /every\s+(day|morning|evening)/i.test(when)
        ? "daily"
        : /every\s+(week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(
              when
            )
          ? "weekly"
          : undefined;
      return {
        tool: "create_reminder",
        args: { task, when, recurrence: rec },
        label: "Creating reminder",
      };
    }
  }

  if (
    /^(?:what('| a)re|show|list|see)\s+(my\s+)?(upcoming\s+|pending\s+)?reminders/.test(
      t
    ) ||
    /^(my reminders|reminders)$/.test(t)
  ) {
    return { tool: "list_reminders", args: {}, label: "Listing reminders" };
  }

  // --- Memory --------------------------------------------------------------
  const mem = text.match(/^(?:please\s+)?remember\s+(?:that\s+)?([\s\S]+)$/i);
  if (mem) {
    return {
      tool: "save_memory",
      args: { content: mem[1].trim() },
      label: "Saving memory",
    };
  }

  if (
    /^(what do you remember( about me)?|show (me )?my memories|my memories|what('| ha)ve you memorized)/.test(
      t
    )
  ) {
    const about = t.match(/about\s+(.+)$/);
    return {
      tool: "search_memory",
      args: { query: about ? about[1] : "everything about the user", limit: 8 },
      label: "Searching memory",
    };
  }

  const forget = text.match(/^(?:please\s+)?(?:forget|delete)\s+(?:that|the memory( that)?)\s+([\s\S]+)$/i);
  if (forget) {
    return {
      tool: "delete_memory",
      args: { query: forget[2].trim() },
      label: "Deleting memory",
    };
  }

  // --- Notes ---------------------------------------------------------------
  const note = text.match(
    /^(?:please\s+)?(?:create|make|write|save|add)\s+(?:a\s+)?(?:new\s+)?note[:\s]+([\s\S]+)$/i
  );
  if (note) {
    const body = note[1].trim();
    const titleM = body.match(/^(?:titled|called|named)\s+"?([^"\n]{2,80})"?\s*[:,-]?\s*([\s\S]*)$/i);
    const title = titleM ? titleM[1] : body.split(/[.\n]/)[0].slice(0, 60);
    const content = titleM && titleM[2] ? titleM[2].trim() : body;
    return {
      tool: "create_note",
      args: { title: title || "Untitled note", content },
      label: "Creating note",
    };
  }

  const findNotes = t.match(
    /(?:find|search|show|look for)\s+(?:my\s+)?notes?\s+(?:about|on|for)\s+(.+)$/
  );
  if (findNotes) {
    return {
      tool: "search_notes",
      args: { query: findNotes[1].trim() },
      label: "Searching notes",
    };
  }

  // --- Time ---------------------------------------------------------------
  if (
    /^(what('| i)s the time|what time is it|current time|what('| i)s the date|what day is (it|today))/.test(
      t
    )
  ) {
    return { tool: "get_current_time", args: {}, label: "Checking time" };
  }

  // --- Web search ----------------------------------------------------------
  const search = text.match(
    /^(?:please\s+)?(?:search(?:\s+the\s+web)?|google|look\s+up)\s+(?:for\s+)?([\s\S]+)$/i
  );
  if (search) {
    return {
      tool: "search_web",
      args: { query: search[1].trim() },
      label: "Searching the web",
    };
  }
  if (
    /(latest|today'?s|recent|current|breaking)\s+(news|headlines|updates)/.test(t) ||
    /^news\b/.test(t) ||
    // time-sensitive information seekers — web search must come first
    /^what('s| is|’s)? happened( today| this week| recently| now)?\b/.test(t) ||
    /\b(today'??s headlines|current affairs|latest prices?|stock (price|market) (today|now)|weather (today|now)|today'??s weather)\b/.test(t)
  ) {
    return {
      tool: "search_web",
      args: { query: text.replace(/^(search for|find|what('| i)s)\s+/i, "") },
      label: "Searching the web",
    };
  }

  return null;
}
