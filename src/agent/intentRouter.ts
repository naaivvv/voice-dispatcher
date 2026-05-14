// ============================================================
// Intent Router — classify what the driver is communicating
// ============================================================

/**
 * Intent categories detected from driver speech.
 * The LLM appends an [INTENT: <category>] tag to its response
 * which we parse out before sending to TTS.
 */
export enum Intent {
    /** Driver reports delay or new arrival time */
    ETA_UPDATE = 'ETA_UPDATE',
    /** Driver changes availability (on break, back active, delayed) */
    STATUS_UPDATE = 'STATUS_UPDATE',
    /** Driver confirms a delivery is done */
    DELIVERY_COMPLETE = 'DELIVERY_COMPLETE',
    /** Driver asks about schedule, route, or instructions */
    QUESTION = 'QUESTION',
    /** Driver requests a human dispatcher or critical situation */
    ESCALATE = 'ESCALATE',
    /** Greetings, small talk, acknowledgments, or unclear */
    GENERAL = 'GENERAL',
}

/** Regex to extract the intent tag from the LLM response */
const INTENT_PATTERN = /\[INTENT:\s*(\w+)\]/i;

/** All valid intent strings for validation */
const VALID_INTENTS = new Set(Object.values(Intent));

export interface ParsedResponse {
    /** The spoken text with the intent tag stripped out */
    text: string;
    /** The detected intent */
    intent: Intent;
}

/**
 * Parse an LLM response to extract the spoken text and intent classification.
 *
 * The LLM is instructed to append `[INTENT: CATEGORY]` at the end of its
 * response. This function strips the tag and returns both the clean text
 * and the parsed intent.
 *
 * If no valid intent tag is found, defaults to `Intent.GENERAL`.
 */
export function parseAgentResponse(rawResponse: string): ParsedResponse {
    const match = INTENT_PATTERN.exec(rawResponse);

    let intent: Intent = Intent.GENERAL;
    let text = rawResponse.trim();

    if (match) {
        const candidate = match[1].toUpperCase();
        if (VALID_INTENTS.has(candidate as Intent)) {
            intent = candidate as Intent;
        }

        // Strip the intent tag from the spoken text
        text = rawResponse.replace(INTENT_PATTERN, '').trim();
    }

    // Clean up any trailing whitespace or empty lines left after tag removal
    text = text.replace(/\n+$/, '').trim();

    return { text, intent };
}
