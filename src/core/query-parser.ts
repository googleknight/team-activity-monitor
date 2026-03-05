/**
 * Query Parser — Extracts intent and person name from natural language input.
 * Uses regex patterns (not AI) for speed and reliability.
 */

import type { ParsedQuery } from "../types/activity.js";

// Regex patterns to extract person names from queries
const QUERY_PATTERNS: Array<{
  pattern: RegExp;
  intent: ParsedQuery["intent"];
}> = [
  // JIRA-specific queries
  {
    pattern:
      /what\s+jira\s+tickets?\s+(?:is|are)\s+(.+?)(?:\s+working\s+on)?$/i,
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

  // GitHub-specific queries
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

  // Full activity queries (most general — match last)
  {
    pattern: /what\s+(?:is|are)\s+(.+?)\s+working\s+on/i,
    intent: "full_activity",
  },
  {
    pattern: /what\s+has\s+(.+?)\s+been\s+(?:working|doing)/i,
    intent: "full_activity",
  },
  {
    pattern: /show\s+(?:me\s+)?(?:recent\s+)?activity\s+(?:for|of)\s+(.+?)$/i,
    intent: "full_activity",
  },
  {
    pattern: /show\s+(?:me\s+)?(.+?)(?:'s|s')\s+(?:recent\s+)?activity/i,
    intent: "full_activity",
  },
  { pattern: /(.+?)(?:'s|s')\s+activity/i, intent: "full_activity" },
  { pattern: /what\s+(?:is|are)\s+(.+?)\s+doing/i, intent: "full_activity" },
  {
    pattern: /tell\s+me\s+about\s+(.+?)(?:'s|s')?\s*$/i,
    intent: "full_activity",
  },
];

// Keywords that determine intent when no specific pattern matches
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
 * Parse a user query to extract intent and person name.
 */
export function parseQuery(input: string): ParsedQuery {
  const trimmed = input.trim();

  if (!trimmed) {
    return { intent: "full_activity", personName: null, raw: trimmed };
  }

  // Try each pattern
  for (const { pattern, intent } of QUERY_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      const name = cleanName(match[1]);
      if (name) {
        return { intent, personName: name, raw: trimmed };
      }
    }
  }

  // Fallback: Try to determine intent from keywords and treat the rest as a name
  const lower = trimmed.toLowerCase();
  let intent: ParsedQuery["intent"] = "full_activity";

  if (JIRA_KEYWORDS.some((kw) => lower.includes(kw))) {
    intent = "jira_only";
  } else if (GITHUB_KEYWORDS.some((kw) => lower.includes(kw))) {
    intent = "github_only";
  }

  // Last resort: treat the entire input as a name (if it looks like one)
  const name = cleanName(trimmed);
  if (name && name.split(" ").length <= 3 && /^[a-zA-Z\s]+$/.test(name)) {
    return { intent, personName: name, raw: trimmed };
  }

  return { intent, personName: null, raw: trimmed };
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
    .replace(/[?!.,;:]+$/g, "") // Remove trailing punctuation
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
}
