/**
 * Query Parser — Extracts intent and person name from natural language input.
 *
 * PRIMARY:  Uses the configured AI (Gemini/OpenAI/Claude) to understand any
 *           phrasing naturally — no rigid patterns required.
 * FALLBACK: If the AI call fails (network, quota, etc.), falls back to a
 *           lightweight regex-based extractor so the app never breaks.
 */

import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { getConfig } from "../config/loader.js";
import type { ParsedQuery } from "../types/activity.js";

const EXTRACTION_PROMPT = `You are a query parser for a team activity monitoring tool.
Given a user's question, extract:
1. "person" — the person's name the user is asking about (null if none found)
2. "intent" — one of: "full_activity", "jira_only", "github_only"

Intent rules:
- "jira_only" if the user specifically asks about JIRA tickets, issues, sprint, or board
- "github_only" if the user specifically asks about commits, PRs, pull requests, code, or repos
- "full_activity" for everything else (general questions like "what is X working on", "tell me about X", etc.)

Respond with ONLY a JSON object, no markdown, no explanation:
{"person": "...", "intent": "..."}

If you cannot find a person name, respond:
{"person": null, "intent": "full_activity"}`;

/**
 * Parse a user query using AI-powered extraction (with regex fallback).
 */
export async function parseQuery(input: string): Promise<ParsedQuery> {
  const trimmed = input.trim();

  if (!trimmed) {
    return { intent: "full_activity", personName: null, raw: trimmed };
  }

  // Try AI-powered extraction first
  try {
    const result = await parseWithAI(trimmed);
    if (result) return result;
  } catch {
    // AI failed — fall through to regex fallback
  }

  // Fallback: regex-based extraction
  return parseWithRegex(trimmed);
}

/**
 * AI-powered query parsing — understands any natural phrasing.
 */
async function parseWithAI(input: string): Promise<ParsedQuery | null> {
  const config = getConfig();
  const aiApiKey = process.env["AI_API_KEY"];

  if (!aiApiKey) return null; // No API key — skip AI

  const providerMap: Record<string, () => ReturnType<typeof google>> = {
    gemini: () => google(config.ai.model),
    openai: () => openai(config.ai.model) as ReturnType<typeof google>,
    claude: () => anthropic(config.ai.model) as ReturnType<typeof google>,
  };

  const getModel = providerMap[config.ai.provider];
  if (!getModel) return null;

  const { text } = await generateText({
    model: getModel(),
    system: EXTRACTION_PROMPT,
    prompt: `User query: "${input}"`,
    temperature: 0, // Deterministic for parsing
  });

  // Parse the JSON response
  const cleaned = text
    .trim()
    .replace(/```json\s*/g, "")
    .replace(/```/g, "");

  try {
    const parsed = JSON.parse(cleaned) as {
      person: string | null;
      intent: string;
    };

    const validIntents = ["full_activity", "jira_only", "github_only"];
    const intent = validIntents.includes(parsed.intent)
      ? (parsed.intent as ParsedQuery["intent"])
      : "full_activity";

    return {
      intent,
      personName: parsed.person || null,
      raw: input,
    };
  } catch {
    // JSON parse failed — fall through
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REGEX FALLBACK — used when AI is unavailable
// ─────────────────────────────────────────────────────────────────────────────

const REGEX_PATTERNS: Array<{
  pattern: RegExp;
  intent: ParsedQuery["intent"];
}> = [
  // JIRA-specific
  {
    pattern:
      /what\s+(?:jira\s+)?tickets?\s+(?:is|are|does|do)\s+(.+?)(?:\s+working\s+on)?$/i,
    intent: "jira_only",
  },
  {
    pattern:
      /show\s+(?:me\s+)?(.+?)(?:'s|s')\s+(?:current\s+)?(?:jira\s+)?issues?/i,
    intent: "jira_only",
  },
  {
    pattern: /(.+?)(?:'s|s')\s+(?:jira\s+)?(?:tickets?|issues?|sprint)/i,
    intent: "jira_only",
  },

  // GitHub-specific
  { pattern: /what\s+has\s+(.+?)\s+committed/i, intent: "github_only" },
  {
    pattern:
      /show\s+(?:me\s+)?(.+?)(?:'s|s')\s+(?:recent\s+)?pull\s+requests?/i,
    intent: "github_only",
  },
  {
    pattern:
      /show\s+(?:me\s+)?(.+?)(?:'s|s')\s+(?:recent\s+)?(?:prs?|commits?|code)/i,
    intent: "github_only",
  },
  {
    pattern: /(.+?)(?:'s|s')\s+(?:github|prs?|pull\s+requests?|commits?)/i,
    intent: "github_only",
  },

  // General activity
  {
    pattern:
      /(?:and\s+)?what\s+(?:is|are|does|do)\s+(.+?)\s+(?:is\s+)?(?:working|doing)/i,
    intent: "full_activity",
  },
  {
    pattern: /(?:and\s+)?what\s+has\s+(.+?)\s+been\s+(?:working|doing)/i,
    intent: "full_activity",
  },
  {
    pattern:
      /(?:and\s+)?show\s+(?:me\s+)?(?:recent\s+)?activity\s+(?:for|of)\s+(.+?)$/i,
    intent: "full_activity",
  },
  {
    pattern:
      /(?:and\s+)?show\s+(?:me\s+)?(.+?)(?:'s|s')\s+(?:recent\s+)?activity/i,
    intent: "full_activity",
  },
  {
    pattern: /(?:and\s+)?(.+?)(?:'s|s')\s+activity/i,
    intent: "full_activity",
  },
  {
    pattern: /(?:and\s+)?tell\s+me\s+about\s+(.+?)(?:'s|s')?\s*$/i,
    intent: "full_activity",
  },
];

const JIRA_KEYWORDS = [
  "jira",
  "ticket",
  "tickets",
  "issue",
  "issues",
  "sprint",
  "board",
];
const GITHUB_KEYWORDS = [
  "github",
  "commit",
  "commits",
  "pr",
  "prs",
  "pull request",
  "pull requests",
  "code",
  "repo",
];

/**
 * Regex-based fallback parser — used when AI is unavailable.
 */
function parseWithRegex(input: string): ParsedQuery {
  // Try each pattern
  for (const { pattern, intent } of REGEX_PATTERNS) {
    const match = input.match(pattern);
    if (match && match[1]) {
      const name = cleanName(match[1]);
      if (name) {
        return { intent, personName: name, raw: input };
      }
    }
  }

  // Keyword-based intent detection
  const lower = input.toLowerCase();
  let intent: ParsedQuery["intent"] = "full_activity";
  if (JIRA_KEYWORDS.some((kw) => lower.includes(kw))) {
    intent = "jira_only";
  } else if (GITHUB_KEYWORDS.some((kw) => lower.includes(kw))) {
    intent = "github_only";
  }

  // Last resort: treat the entire input as a name (if it looks like one)
  const name = cleanName(input);
  if (name && name.split(" ").length <= 3 && /^[a-zA-Z\s]+$/.test(name)) {
    return { intent, personName: name, raw: input };
  }

  return { intent, personName: null, raw: input };
}

/**
 * Clean up an extracted name — remove common filler words and extra whitespace.
 */
function cleanName(raw: string): string {
  return raw
    .replace(
      /\b(these days|this week|this month|recently|lately|today|currently)\b/gi,
      "",
    )
    .replace(/[?!.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
