/**
 * JIRA REST API Client.
 * Handles authentication, issue search, sprint fetching, and user discovery.
 */

import { getConfig } from "../config/loader.js";
import type {
  JiraIssue,
  Sprint,
  JiraUserSearchResult,
  DateRange,
} from "../types/jira.js";
import { JiraApiError } from "../types/errors.js";

/**
 * Make an authenticated request to the JIRA REST API.
 */
async function jiraFetch(path: string): Promise<unknown> {
  const config = getConfig();
  if (!config.jira.baseUrl || !config.jira.apiToken) {
    throw new JiraApiError(
      "JIRA is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in .env",
      "JIRA_NOT_CONFIGURED",
    );
  }

  const url = `${config.jira.baseUrl}${path}`;
  const auth = Buffer.from(
    `${config.jira.email}:${config.jira.apiToken}`,
  ).toString("base64");

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401) {
      throw new JiraApiError(
        "JIRA authentication failed. Please check your API token in .env",
        "JIRA_AUTH_FAILED",
      );
    }
    if (response.status === 403) {
      throw new JiraApiError(
        "No permission to access JIRA. Check that your token has read access.",
        "JIRA_FORBIDDEN",
      );
    }
    throw new JiraApiError(
      `JIRA API error (${response.status}): ${body}`,
      "JIRA_API_ERROR",
    );
  }

  return response.json();
}

/**
 * Build a JQL query string for fetching a user's issues.
 */
export function buildJqlQuery(
  accountId: string,
  projectKeys: string[],
  dateRange: DateRange,
): string {
  const projects = projectKeys.map((k) => `"${k}"`).join(", ");
  const startDate = dateRange.from.toISOString().split("T")[0]; // yyyy-mm-dd

  return `assignee = "${accountId}" AND project IN (${projects}) AND updated >= "${startDate}" ORDER BY updated DESC`;
}

/**
 * Calculate the date range based on config (sprints or days).
 */
export function getDateRange(): DateRange {
  const config = getConfig();
  const to = new Date();
  const from = new Date();

  // Use days lookback (sprints mode would require fetching sprints first)
  const days =
    config.jira.lookbackMode === "days"
      ? config.jira.lookbackDays
      : config.jira.lookbackSprints * 14; // Approximate: 2 weeks per sprint

  from.setDate(from.getDate() - days);

  return { from, to };
}

/**
 * Fetch all issues assigned to a user within the configured time range.
 */
export async function getUserIssues(accountId: string): Promise<JiraIssue[]> {
  const config = getConfig();
  const dateRange = getDateRange();
  const jql = buildJqlQuery(accountId, config.jira.projectKeys, dateRange);

  const fields = [
    "summary",
    "status",
    "priority",
    "issuetype",
    "updated",
    "sprint",
    "story_points",
    "customfield_10016", // story_points custom field
  ].join(",");

  const encodedJql = encodeURIComponent(jql);
  const data = (await jiraFetch(
    `/rest/api/3/search?jql=${encodedJql}&fields=${fields}&maxResults=50`,
  )) as { issues?: Array<Record<string, unknown>>; total?: number };

  const issues = data.issues || [];

  return issues.map((issue: Record<string, unknown>): JiraIssue => {
    const fields = (issue["fields"] as Record<string, unknown>) || {};
    const status = (fields["status"] as Record<string, unknown>) || {};
    const statusCategory =
      (status["statusCategory"] as Record<string, unknown>) || {};
    const priority = (fields["priority"] as Record<string, unknown>) || {};
    const issueType = (fields["issuetype"] as Record<string, unknown>) || {};
    const sprint = (fields["sprint"] as Record<string, unknown>) || null;

    return {
      key: issue["key"] as string,
      summary: (fields["summary"] as string) || "No summary",
      status: (status["name"] as string) || "Unknown",
      statusCategory: (statusCategory["name"] as string) || "Unknown",
      priority: (priority["name"] as string) || "None",
      issueType: (issueType["name"] as string) || "Unknown",
      updatedAt: new Date(fields["updated"] as string),
      sprintName: sprint ? (sprint["name"] as string) : undefined,
      storyPoints:
        (fields["story_points"] as number) ||
        (fields["customfield_10016"] as number) ||
        undefined,
    };
  });
}

/**
 * Fetch recent sprints for the configured board.
 */
export async function getRecentSprints(
  boardId: number,
  count: number,
): Promise<Sprint[]> {
  if (!boardId || boardId === 0) return [];

  try {
    const data = (await jiraFetch(
      `/rest/agile/1.0/board/${boardId}/sprint?state=active,closed&maxResults=${count}`,
    )) as { values?: Array<Record<string, unknown>> };

    return (data.values || []).map(
      (s: Record<string, unknown>): Sprint => ({
        id: s["id"] as number,
        name: s["name"] as string,
        state: s["state"] as string,
        startDate: new Date(s["startDate"] as string),
        endDate: new Date(s["endDate"] as string),
      }),
    );
  } catch {
    // Sprint data is optional — fail gracefully
    return [];
  }
}

/**
 * Search for JIRA users by name (hybrid registry fallback).
 */
export async function searchUsers(
  query: string,
): Promise<JiraUserSearchResult[]> {
  try {
    const data = (await jiraFetch(
      `/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=5`,
    )) as Array<Record<string, unknown>>;

    return (Array.isArray(data) ? data : []).map(
      (u): JiraUserSearchResult => ({
        accountId: u["accountId"] as string,
        displayName: u["displayName"] as string,
        emailAddress: u["emailAddress"] as string | undefined,
        active: u["active"] as boolean,
      }),
    );
  } catch {
    // User search failure is non-fatal
    return [];
  }
}

/**
 * Check if JIRA is configured and accessible.
 */
export async function testConnection(): Promise<boolean> {
  try {
    await jiraFetch("/rest/api/3/myself");
    return true;
  } catch {
    return false;
  }
}
