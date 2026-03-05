/**
 * User Matcher — Resolves a name string to a TeamMember using fuzzy matching
 * and online API discovery (hybrid registry).
 */

import Fuse from "fuse.js";
import { getConfig, persistTeamMember } from "../config/loader.js";
import * as jiraClient from "../clients/jira-client.js";
import * as githubClient from "../clients/github-client.js";
import type { TeamMember, MatchResult } from "../types/activity.js";

/**
 * Find a team member locally by name (exact, partial, or fuzzy).
 */
export function findMemberLocal(
  query: string,
  team: TeamMember[],
): MatchResult {
  if (team.length === 0) {
    return { status: "not_found" };
  }

  const queryLower = query.toLowerCase().trim();

  // 1. Exact match (case-insensitive)
  const exactMatch = team.find((m) => m.name.toLowerCase() === queryLower);
  if (exactMatch) {
    return { status: "found", member: exactMatch };
  }

  // 2. Partial match (first name or last name)
  const partialMatches = team.filter((m) => {
    const nameParts = m.name.toLowerCase().split(" ");
    return nameParts.some((part) => part === queryLower);
  });

  if (partialMatches.length === 1) {
    return { status: "found", member: partialMatches[0] };
  }
  if (partialMatches.length > 1) {
    return { status: "ambiguous", candidates: partialMatches };
  }

  // 3. GitHub username match
  const usernameMatch = team.find(
    (m) => m.githubUsername.toLowerCase() === queryLower,
  );
  if (usernameMatch) {
    return { status: "found", member: usernameMatch };
  }

  // 4. Fuzzy match using Fuse.js
  const fuse = new Fuse(team, {
    keys: ["name", "githubUsername"],
    threshold: 0.4, // 0 = perfect match, 1 = match anything
    includeScore: true,
  });

  const fuzzyResults = fuse.search(query);

  if (fuzzyResults.length === 0) {
    return { status: "not_found" };
  }

  // Auto-select if high confidence (score < 0.15 means >85% match)
  if (
    fuzzyResults.length === 1 ||
    (fuzzyResults[0]!.score !== undefined && fuzzyResults[0]!.score < 0.15)
  ) {
    return { status: "found", member: fuzzyResults[0]!.item };
  }

  // Multiple close matches — let user disambiguate
  const topCandidates = fuzzyResults.slice(0, 5).map((r) => r.item);
  return { status: "ambiguous", candidates: topCandidates };
}

/**
 * Discover a user via JIRA and GitHub API search.
 * Returns candidates for the user to confirm.
 */
export async function discoverMember(query: string): Promise<MatchResult> {
  const [jiraResults, githubResults] = await Promise.allSettled([
    jiraClient.searchUsers(query),
    githubClient.searchUsers(query),
  ]);

  const jiraUsers = jiraResults.status === "fulfilled" ? jiraResults.value : [];
  const githubUsers =
    githubResults.status === "fulfilled" ? githubResults.value : [];

  if (jiraUsers.length === 0 && githubUsers.length === 0) {
    return { status: "not_found" };
  }

  // Combine into candidate TeamMembers
  const candidates: TeamMember[] = [];

  // Try to pair JIRA and GitHub users by name similarity
  for (const jUser of jiraUsers) {
    const matchingGH = githubUsers.find((g) => {
      if (!g.name) return false;
      return (
        g.name.toLowerCase().includes(query.toLowerCase()) ||
        jUser.displayName.toLowerCase().includes(query.toLowerCase())
      );
    });

    candidates.push({
      name: jUser.displayName,
      jiraAccountId: jUser.accountId,
      githubUsername: matchingGH?.login || "",
    });
  }

  // Add GitHub users not matched to any JIRA user
  for (const gUser of githubUsers) {
    const alreadyAdded = candidates.some(
      (c) => c.githubUsername === gUser.login,
    );
    if (!alreadyAdded) {
      candidates.push({
        name: gUser.name || gUser.login,
        jiraAccountId: "",
        githubUsername: gUser.login,
      });
    }
  }

  if (candidates.length === 0) {
    return { status: "not_found" };
  }

  return { status: "discovered", candidates };
}

/**
 * Persist a confirmed member to config.yaml for future lookups.
 */
export function saveMember(member: TeamMember): void {
  persistTeamMember(member);
}

/**
 * Get the full team list from config.
 */
export function getTeam(): TeamMember[] {
  return getConfig().team;
}
