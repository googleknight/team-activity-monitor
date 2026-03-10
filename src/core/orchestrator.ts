/**
 * Orchestrator — Main pipeline that wires together all modules.
 * Handles the full flow: parse → match → fetch → format → generate → display
 */

import { getConfig } from "../config/loader.js";
import * as jiraClient from "../clients/jira-client.js";
import * as githubClient from "../clients/github-client.js";
import * as aiClient from "../clients/ai-client.js";
import { parseQuery } from "./query-parser.js";
import {
  findMemberLocal,
  discoverMember,
  saveMember,
  getTeam,
} from "./user-matcher.js";
import { CacheManager } from "./cache-manager.js";
import {
  formatDataForPrompt,
  formatTemplateFallback,
  formatOutputForTerminal,
} from "./response-formatter.js";
import type { TeamMember, SourceData, ParsedQuery } from "../types/activity.js";
import type { JiraIssue } from "../types/jira.js";
import type { GitHubActivity } from "../types/github.js";
import {
  AppError,
  JiraApiError,
  GithubApiError,
  AIProviderError,
} from "../types/errors.js";

let cache: CacheManager;

/**
 * Initialize the orchestrator (call once at startup).
 */
export function init(): void {
  const config = getConfig();
  cache = new CacheManager(config.cache.ttlMinutes, config.cache.enabled);
}

/**
 * Clear the cache.
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Process a user query end-to-end.
 * Returns a formatted string ready for terminal output.
 *
 * @param promptForDisambiguation - callback to ask the user to pick from candidates
 */
export async function processQuery(
  input: string,
  promptForDisambiguation: (
    candidates: TeamMember[],
    query: string,
  ) => Promise<TeamMember | null>,
): Promise<string> {
  // Step 1: Parse the query (AI-powered with regex fallback)
  const parsed = await parseQuery(input);

  // Step 1.5: Handle team-wide queries
  if (parsed.scope === "team") {
    return await processTeamQuery(parsed);
  }

  if (!parsed.personName) {
    return (
      "❓ I couldn't figure out who you're asking about. Try something like:\n" +
      '   "What is John working on?"\n' +
      '   "Show me Sarah\'s pull requests"\n' +
      '   "Who all worked on GitHub this week?"\n' +
      "   Type `help` for more examples."
    );
  }

  // Step 2: Resolve the person
  const member = await resolveTeamMember(
    parsed.personName,
    promptForDisambiguation,
  );
  if (!member) {
    return `❌ Could not resolve "${parsed.personName}" to a team member. Type \`team\` to see who's configured.`;
  }

  // Step 3: Fetch data based on intent
  const { jiraIssues, githubActivity, errors } = await fetchActivity(
    member,
    parsed,
  );

  // Step 4: Handle cases where both APIs failed
  if (
    jiraIssues.length === 0 &&
    githubActivity.commits.length === 0 &&
    githubActivity.pullRequests.length === 0
  ) {
    if (errors.length > 0) {
      return (
        `⚠️  Couldn't fetch activity for ${member.name}:\n` +
        errors.map((e) => `  • ${e}`).join("\n")
      );
    }
    return `📭 No recent activity found for ${member.name} in the configured time window.`;
  }

  // Step 5: Generate response
  return await generateResponse(
    member,
    parsed,
    jiraIssues,
    githubActivity,
    errors,
  );
}

/**
 * Process a team-wide query — fetch activity for all configured members.
 */
async function processTeamQuery(parsed: ParsedQuery): Promise<string> {
  const team = getTeam();

  if (team.length === 0) {
    return (
      "📭 No team members configured yet.\n" +
      '   Ask about someone by name first (e.g., "What is John working on?") and I\'ll discover them.'
    );
  }

  const results: string[] = [];
  const allErrors: string[] = [];

  for (const member of team) {
    const { jiraIssues, githubActivity, errors } = await fetchActivity(
      member,
      parsed,
    );

    allErrors.push(...errors.map((e) => `${member.name}: ${e}`));

    const hasActivity =
      jiraIssues.length > 0 ||
      githubActivity.commits.length > 0 ||
      githubActivity.pullRequests.length > 0;

    if (hasActivity) {
      const summary = formatTemplateFallback(
        member,
        jiraIssues,
        githubActivity,
      );
      results.push(summary);
    } else {
      results.push(`📭 ${member.name} — No recent activity found.\n`);
    }
  }

  let output = `\n📋 Team Activity Summary (${team.length} members)\n${"━".repeat(50)}\n\n`;
  output += results.join("\n");

  if (allErrors.length > 0) {
    output += "\n" + allErrors.map((e) => `⚠️  ${e}`).join("\n") + "\n";
  }

  return output;
}

/**
 * Resolve a name string to a TeamMember (local → API → user confirmation).
 */
async function resolveTeamMember(
  name: string,
  promptForDisambiguation: (
    candidates: TeamMember[],
    query: string,
  ) => Promise<TeamMember | null>,
): Promise<TeamMember | null> {
  // Try local first
  const localResult = findMemberLocal(name, getTeam());

  if (localResult.status === "found" && localResult.member) {
    return localResult.member;
  }

  if (localResult.status === "ambiguous" && localResult.candidates) {
    const selected = await promptForDisambiguation(
      localResult.candidates,
      name,
    );
    if (selected && (selected.jiraAccountId || selected.githubUsername)) {
      saveMember(selected);
    }
    return selected;
  }

  // Not found locally — try API discovery
  const discoveryResult = await discoverMember(name);

  if (discoveryResult.status === "not_found") {
    return null;
  }

  if (discoveryResult.candidates && discoveryResult.candidates.length > 0) {
    const selected = await promptForDisambiguation(
      discoveryResult.candidates,
      name,
    );
    if (selected) {
      // Persist for future lookups
      if (selected.jiraAccountId || selected.githubUsername) {
        saveMember(selected);
      }
    }
    return selected;
  }

  return null;
}

/**
 * Fetch JIRA and/or GitHub activity based on the query intent.
 */
async function fetchActivity(
  member: TeamMember,
  parsed: ParsedQuery,
): Promise<{
  jiraIssues: JiraIssue[];
  githubActivity: GitHubActivity;
  errors: string[];
}> {
  const config = getConfig();
  const errors: string[] = [];
  let jiraIssues: JiraIssue[] = [];
  let githubActivity: GitHubActivity = { commits: [], pullRequests: [] };

  const since = new Date();
  since.setDate(since.getDate() - config.github.lookbackDays);

  // Fetch JIRA data
  if (parsed.intent !== "github_only" && member.jiraAccountId) {
    const cacheKey = `jira:${member.jiraAccountId}`;
    const cached = cache.get<JiraIssue[]>(cacheKey);

    if (cached) {
      jiraIssues = cached;
    } else {
      try {
        jiraIssues = await jiraClient.getUserIssues(member.jiraAccountId);
        cache.set(cacheKey, jiraIssues);
      } catch (err) {
        if (err instanceof JiraApiError) {
          errors.push(`JIRA: ${err.message}`);
        } else {
          errors.push(
            `JIRA: Unexpected error — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  } else if (parsed.intent !== "github_only" && !member.jiraAccountId) {
    errors.push("JIRA: No JIRA account ID configured for this member");
  }

  // Fetch GitHub data
  if (parsed.intent !== "jira_only" && member.githubUsername) {
    const cacheKey = `github:${member.githubUsername}`;
    const cached = cache.get<GitHubActivity>(cacheKey);

    if (cached) {
      githubActivity = cached;
    } else {
      try {
        githubActivity = await githubClient.getUserActivity(
          member.githubUsername,
          since,
        );
        cache.set(cacheKey, githubActivity);
      } catch (err) {
        if (err instanceof GithubApiError) {
          errors.push(`GitHub: ${err.message}`);
        } else {
          errors.push(
            `GitHub: Unexpected error — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  } else if (parsed.intent !== "jira_only" && !member.githubUsername) {
    errors.push("GitHub: No GitHub username configured for this member");
  }

  return { jiraIssues, githubActivity, errors };
}

/**
 * Generate the final response using AI (with fallback to template).
 */
async function generateResponse(
  member: TeamMember,
  parsed: ParsedQuery,
  jiraIssues: JiraIssue[],
  githubActivity: GitHubActivity,
  partialErrors: string[],
): Promise<string> {
  const dateRange = jiraClient.getDateRange();

  // Build source data for hallucination validation
  const sourceData: SourceData = {
    jiraKeys: new Set(jiraIssues.map((i) => i.key)),
    prNumbers: new Set(
      githubActivity.pullRequests.map((pr) => `#${pr.number}`),
    ),
    repos: new Set([
      ...githubActivity.commits.map((c) => c.repo),
      ...githubActivity.pullRequests.map((pr) => pr.repo),
    ]),
    memberName: member.name,
    jiraIssues,
    githubActivity,
  };

  // Format data for AI prompt
  const prompt = formatDataForPrompt(
    member.name,
    dateRange,
    jiraIssues,
    githubActivity,
  );

  try {
    const { text, usedFallback } = await aiClient.generateWithRetry(
      prompt,
      sourceData,
    );

    if (usedFallback || !text) {
      return formatTemplateFallback(member, jiraIssues, githubActivity);
    }

    let output = formatOutputForTerminal(text, member.name);

    // Append partial errors if any
    if (partialErrors.length > 0) {
      output += "\n" + partialErrors.map((e) => `⚠️  ${e}`).join("\n") + "\n";
    }

    return output;
  } catch (err) {
    // AI failed — use template fallback
    let output = formatTemplateFallback(member, jiraIssues, githubActivity);

    if (partialErrors.length > 0) {
      output += "\n" + partialErrors.map((e) => `⚠️  ${e}`).join("\n") + "\n";
    }

    return output;
  }
}
