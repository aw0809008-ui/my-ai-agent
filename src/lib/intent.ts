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

const TIME = String.raw`(?:at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?(?:\s+(?:today|tomorrow|tonight|morning|evening|afternoon|night))?|tomorrow(?:\s+(?:morning|evening|afternoon|night))?(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)?|tonight|today|this\s+(?:morning|evening|afternoon)|in\s+\d+\s*(?:minutes?|mins?|hours?|hrs?|days?)|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)?|next\s+week|every\s+(?:day|morning|evening|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)?)`;
const TIME_AT_END = new RegExp(`^([\\s\\S]*?)\\s+(${TIME})[.,!?\\s]*$`, "i");
const TIME_AT_START = new RegExp(`^(${TIME})[.,!?\\s]*\\s+(?:to\\s+)?([\\s\\S]+)$`, "i");

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
