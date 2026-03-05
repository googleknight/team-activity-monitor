/**
 * Unified activity model that combines data from JIRA and GitHub.
 */

import type { JiraIssue } from "./jira.js";
import type { GitHubActivity } from "./github.js";

export interface TeamMember {
  name: string;
  jiraAccountId: string;
  githubUsername: string;
}

export interface TeamMemberActivity {
  member: TeamMember;
  period: { from: Date; to: Date };
  jira: {
    issues: JiraIssue[];
    summary: {
      total: number;
      byStatus: Record<string, number>;
      byType: Record<string, number>;
    };
  };
  github: {
    activity: GitHubActivity;
    summary: {
      totalCommits: number;
      totalPRs: number;
      reposContributed: string[];
    };
  };
}

/** Parsed user query with intent and extracted name */
export interface ParsedQuery {
  intent: "full_activity" | "jira_only" | "github_only";
  personName: string | null;
  raw: string;
}

/** Result of attempting to match a name to a team member */
export interface MatchResult {
  status: "found" | "ambiguous" | "not_found" | "discovered";
  member?: TeamMember;
  candidates?: TeamMember[];
}

/** Source data references used for hallucination validation */
export interface SourceData {
  jiraKeys: Set<string>;
  prNumbers: Set<string>;
  repos: Set<string>;
  memberName: string;
  jiraIssues: JiraIssue[];
  githubActivity: GitHubActivity;
}

/** Result of validating an AI response for hallucinations */
export interface ValidationResult {
  isValid: boolean;
  hallucinations: string[];
  confidence: number;
}
