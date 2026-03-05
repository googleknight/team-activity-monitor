/**
 * Response Formatter — Formats data for AI prompts and terminal output.
 * Includes template-based fallback for when AI is unavailable.
 */

import chalk from "chalk";
import type { JiraIssue } from "../types/jira.js";
import type { GitHubActivity } from "../types/github.js";
import type { TeamMember, TeamMemberActivity } from "../types/activity.js";

/**
 * Format JIRA + GitHub data into a structured text block for the AI prompt.
 */
export function formatDataForPrompt(
  memberName: string,
  dateRange: { from: Date; to: Date },
  jiraIssues: JiraIssue[],
  githubActivity: GitHubActivity,
): string {
  const fromStr = dateRange.from.toISOString().split("T")[0];
  const toStr = dateRange.to.toISOString().split("T")[0];

  let prompt = `Team member: ${memberName}\n`;
  prompt += `Time period: ${fromStr} to ${toStr}\n\n`;

  // JIRA section
  prompt += `=== JIRA Data ===\n`;
  if (jiraIssues.length === 0) {
    prompt += `No JIRA issues found for this period.\n`;
  } else {
    prompt += `Total issues: ${jiraIssues.length}\n\n`;
    for (const issue of jiraIssues) {
      prompt += `- ${issue.key}: ${issue.summary}\n`;
      prompt += `  Status: ${issue.status} (${issue.statusCategory})\n`;
      prompt += `  Type: ${issue.issueType} | Priority: ${issue.priority}\n`;
      if (issue.sprintName) prompt += `  Sprint: ${issue.sprintName}\n`;
      if (issue.storyPoints) prompt += `  Story Points: ${issue.storyPoints}\n`;
      prompt += `  Updated: ${issue.updatedAt.toISOString().split("T")[0]}\n\n`;
    }
  }

  // GitHub section
  prompt += `\n=== GitHub Data ===\n`;

  // Commits
  if (githubActivity.commits.length === 0) {
    prompt += `No commits found for this period.\n`;
  } else {
    prompt += `Total commits: ${githubActivity.commits.length}\n\n`;
    // Show up to 20 most recent commits
    for (const commit of githubActivity.commits.slice(0, 20)) {
      prompt += `- [${commit.sha}] ${commit.message} (${commit.repo}, ${commit.date.toISOString().split("T")[0]})\n`;
    }
    if (githubActivity.commits.length > 20) {
      prompt += `  ... and ${githubActivity.commits.length - 20} more commits\n`;
    }
  }

  // Pull Requests
  prompt += `\n`;
  if (githubActivity.pullRequests.length === 0) {
    prompt += `No pull requests found for this period.\n`;
  } else {
    prompt += `Total PRs: ${githubActivity.pullRequests.length}\n\n`;
    for (const pr of githubActivity.pullRequests) {
      prompt += `- PR #${pr.number}: ${pr.title}\n`;
      prompt += `  State: ${pr.state} | Repo: ${pr.repo}\n`;
      prompt += `  Changes: +${pr.additions} -${pr.deletions} (${pr.changedFiles} files)\n`;
      prompt += `  Created: ${pr.createdAt.toISOString().split("T")[0]}`;
      if (pr.mergedAt)
        prompt += ` | Merged: ${pr.mergedAt.toISOString().split("T")[0]}`;
      prompt += `\n  URL: ${pr.url}\n\n`;
    }
  }

  return prompt;
}

/**
 * Template-based fallback when AI is unavailable.
 * Guarantees 100% factual output — just formatted raw data.
 */
export function formatTemplateFallback(
  member: TeamMember,
  jiraIssues: JiraIssue[],
  githubActivity: GitHubActivity,
): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold(`📋 ${member.name} — Activity Summary`));
  lines.push(chalk.dim("━".repeat(50)));
  lines.push("");

  // JIRA Section
  if (jiraIssues.length > 0) {
    lines.push(chalk.bold.blue(`JIRA Issues (${jiraIssues.length})`));

    // Group by status category
    const grouped = groupBy(jiraIssues, (i) => i.statusCategory);

    const statusIcons: Record<string, string> = {
      "In Progress": "🟡",
      "To Do": "📦",
      Done: "🟢",
    };

    for (const [category, issues] of Object.entries(grouped)) {
      const icon = statusIcons[category] || "⚪";
      lines.push(`  ${icon} ${chalk.bold(category)}:`);
      for (const issue of issues) {
        const priority =
          issue.priority === "High" || issue.priority === "Highest"
            ? chalk.red(`[${issue.priority}]`)
            : "";
        lines.push(
          `    • ${chalk.cyan(issue.key)} — ${issue.summary} ${priority}`,
        );
      }
    }
    lines.push("");
  } else {
    lines.push(chalk.dim("No JIRA issues found."));
    lines.push("");
  }

  // GitHub Section
  if (
    githubActivity.pullRequests.length > 0 ||
    githubActivity.commits.length > 0
  ) {
    lines.push(chalk.bold.blue(`GitHub Activity`));

    // PRs
    if (githubActivity.pullRequests.length > 0) {
      lines.push(`  Pull Requests (${githubActivity.pullRequests.length}):`);
      for (const pr of githubActivity.pullRequests) {
        const stateIcon =
          pr.state === "merged" ? "🟣" : pr.state === "open" ? "🟢" : "🔴";
        const changes = chalk.dim(`+${pr.additions} -${pr.deletions}`);
        lines.push(
          `    ${stateIcon} PR #${pr.number} (${pr.state}) — ${pr.title} [${pr.repo}] ${changes}`,
        );
      }
    }

    // Commits
    if (githubActivity.commits.length > 0) {
      const repos = [...new Set(githubActivity.commits.map((c) => c.repo))];
      lines.push(
        `  Commits: ${githubActivity.commits.length} across ${repos.join(", ")}`,
      );
    }
    lines.push("");
  } else {
    lines.push(chalk.dim("No GitHub activity found."));
    lines.push("");
  }

  lines.push(
    chalk.dim.italic(
      "⚠️  This is a raw data view. AI summary was unavailable.",
    ),
  );
  lines.push("");

  return lines.join("\n");
}

/**
 * Format the AI response for terminal display.
 * Applies basic markdown-to-terminal conversion.
 */
export function formatOutputForTerminal(
  response: string,
  memberName: string,
): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold(`📋 ${memberName} — Activity Summary`));
  lines.push(chalk.dim("━".repeat(50)));
  lines.push("");

  // Basic markdown → chalk conversion
  let formatted = response
    // Bold: **text** → chalk.bold(text)
    .replace(/\*\*(.+?)\*\*/g, (_, text) => chalk.bold(text))
    // Inline code: `text` → chalk.cyan(text)
    .replace(/`(.+?)`/g, (_, text) => chalk.cyan(text))
    // Headers: ## text → bold
    .replace(/^#{1,3}\s+(.+)$/gm, (_, text) => chalk.bold(text))
    // JIRA ticket keys → cyan
    .replace(/\b([A-Z][A-Z0-9]+-\d+)\b/g, (_, key) => chalk.cyan(key))
    // PR numbers → magenta
    .replace(/#(\d+)/g, (_, num) => chalk.magenta(`#${num}`));

  lines.push(formatted);
  lines.push("");

  return lines.join("\n");
}

/**
 * Helper: Group an array by a key function.
 */
function groupBy<T>(
  items: T[],
  keyFn: (item: T) => string,
): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key]!.push(item);
  }
  return groups;
}
