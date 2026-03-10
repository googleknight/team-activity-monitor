/**
 * GitHub REST API Client.
 * Handles authentication, commit/PR fetching, and user discovery.
 */

import { getConfig } from "../config/loader.js";
import type {
  GitHubCommit,
  GitHubPR,
  GitHubActivity,
  GitHubUserSearchResult,
} from "../types/github.js";
import { GithubApiError } from "../types/errors.js";

const GITHUB_API = "https://api.github.com";

/**
 * Make an authenticated request to the GitHub REST API.
 */
async function githubFetch(path: string): Promise<unknown> {
  const config = getConfig();
  if (!config.github.token) {
    throw new GithubApiError(
      "GitHub is not configured. Set GITHUB_TOKEN in .env",
      "GITHUB_NOT_CONFIGURED",
    );
  }

  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.github.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401) {
      throw new GithubApiError(
        "GitHub authentication failed. Please check your GITHUB_TOKEN in .env",
        "GITHUB_AUTH_FAILED",
      );
    }
    if (response.status === 403) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        const resetTs = response.headers.get("x-ratelimit-reset");
        const resetMinutes = resetTs
          ? Math.ceil((parseInt(resetTs) * 1000 - Date.now()) / 60000)
          : "??";
        throw new GithubApiError(
          `GitHub API rate limit hit. Try again in ${resetMinutes} minutes.`,
          "GITHUB_RATE_LIMITED",
        );
      }
      throw new GithubApiError(
        "No permission to access GitHub. Check your token permissions.",
        "GITHUB_FORBIDDEN",
      );
    }
    if (response.status === 404) {
      throw new GithubApiError(
        `GitHub resource not found: ${path}`,
        "GITHUB_NOT_FOUND",
      );
    }
    throw new GithubApiError(
      `GitHub API error (${response.status}): ${body}`,
      "GITHUB_API_ERROR",
    );
  }

  return response.json();
}

/**
 * Parse "owner/repo" into [owner, repo].
 */
function parseRepoSlug(slug: string): [string, string] {
  const parts = slug.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new GithubApiError(
      `Invalid repo format: "${slug}". Expected "owner/repo".`,
      "GITHUB_INVALID_REPO",
    );
  }
  return [parts[0], parts[1]];
}

/**
 * Fetch recent commits by a user from a single repo.
 */
async function getRepoCommits(
  owner: string,
  repo: string,
  username: string,
  since: Date,
): Promise<GitHubCommit[]> {
  try {
    const sinceStr = since.toISOString();
    const data = (await githubFetch(
      `/repos/${owner}/${repo}/commits?author=${encodeURIComponent(username)}&since=${sinceStr}&per_page=100`,
    )) as Array<Record<string, unknown>>;

    return (Array.isArray(data) ? data : []).map((c): GitHubCommit => {
      const commit = (c["commit"] as Record<string, unknown>) || {};
      const author = (commit["author"] as Record<string, unknown>) || {};

      return {
        sha: ((c["sha"] as string) || "").substring(0, 7),
        message: ((commit["message"] as string) || "").split("\n")[0] || "", // First line only
        date: new Date(author["date"] as string),
        repo: `${owner}/${repo}`,
        url: (c["html_url"] as string) || "",
      };
    });
  } catch (err) {
    if (err instanceof GithubApiError && err.code === "GITHUB_NOT_FOUND") {
      console.warn(
        `⚠️  Repository ${owner}/${repo} not found or not accessible.`,
      );
      return [];
    }
    throw err;
  }
}

/**
 * Fetch recent PRs by a user from a single repo.
 */
async function getRepoPullRequests(
  owner: string,
  repo: string,
  username: string,
  since: Date,
): Promise<GitHubPR[]> {
  try {
    // Fetch both open and recently closed PRs
    const [openPRs, closedPRs] = await Promise.allSettled([
      githubFetch(
        `/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=50`,
      ) as Promise<Array<Record<string, unknown>>>,
      githubFetch(
        `/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`,
      ) as Promise<Array<Record<string, unknown>>>,
    ]);

    const allPRs: Array<Record<string, unknown>> = [];
    if (openPRs.status === "fulfilled")
      allPRs.push(...(Array.isArray(openPRs.value) ? openPRs.value : []));
    if (closedPRs.status === "fulfilled")
      allPRs.push(...(Array.isArray(closedPRs.value) ? closedPRs.value : []));

    // Filter by author and date
    const userPRs = allPRs.filter((pr) => {
      const prUser = (pr["user"] as Record<string, unknown>) || {};
      const login = ((prUser["login"] as string) || "").toLowerCase();
      const updatedAt = new Date(pr["updated_at"] as string);
      return login === username.toLowerCase() && updatedAt >= since;
    });

    // Fetch detailed PR data for each (to get additions/deletions)
    const detailedPRs = await Promise.allSettled(
      userPRs.slice(0, 20).map(async (pr): Promise<GitHubPR> => {
        const prNumber = pr["number"] as number;
        let details = pr;

        // Try to get detailed data (includes additions/deletions)
        try {
          details = (await githubFetch(
            `/repos/${owner}/${repo}/pulls/${prNumber}`,
          )) as Record<string, unknown>;
        } catch {
          // Use basic data if detail fetch fails
        }

        const mergedAt = details["merged_at"] as string | null;
        const state = mergedAt
          ? "merged"
          : (details["state"] as string) === "closed"
            ? "closed"
            : "open";

        return {
          number: prNumber,
          title: (details["title"] as string) || "",
          state: state as "open" | "closed" | "merged",
          repo: `${owner}/${repo}`,
          createdAt: new Date(details["created_at"] as string),
          mergedAt: mergedAt ? new Date(mergedAt) : undefined,
          url: (details["html_url"] as string) || "",
          additions: (details["additions"] as number) || 0,
          deletions: (details["deletions"] as number) || 0,
          changedFiles: (details["changed_files"] as number) || 0,
        };
      }),
    );

    return detailedPRs
      .filter(
        (r): r is PromiseFulfilledResult<GitHubPR> => r.status === "fulfilled",
      )
      .map((r) => r.value);
  } catch (err) {
    if (err instanceof GithubApiError && err.code === "GITHUB_NOT_FOUND") {
      console.warn(
        `⚠️  Repository ${owner}/${repo} not found or not accessible.`,
      );
      return [];
    }
    throw err;
  }
}

/**
 * Fetch recent commits across all configured repos for a user.
 */
export async function getUserCommits(
  username: string,
  since: Date,
): Promise<GitHubCommit[]> {
  const config = getConfig();

  const results = await Promise.allSettled(
    config.github.repos.map((slug) => {
      const [owner, repo] = parseRepoSlug(slug);
      return getRepoCommits(owner, repo, username, since);
    }),
  );

  const commits: GitHubCommit[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      commits.push(...result.value);
    }
  }

  // Sort by date descending
  return commits.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/**
 * Fetch recent PRs across all configured repos for a user.
 */
export async function getUserPullRequests(
  username: string,
  since: Date,
): Promise<GitHubPR[]> {
  const config = getConfig();

  const results = await Promise.allSettled(
    config.github.repos.map((slug) => {
      const [owner, repo] = parseRepoSlug(slug);
      return getRepoPullRequests(owner, repo, username, since);
    }),
  );

  const prs: GitHubPR[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      prs.push(...result.value);
    }
  }

  // Sort by created date descending
  return prs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Aggregate all GitHub activity for a user.
 */
export async function getUserActivity(
  username: string,
  since: Date,
): Promise<GitHubActivity> {
  const [commits, pullRequests] = await Promise.all([
    getUserCommits(username, since),
    getUserPullRequests(username, since),
  ]);

  return { commits, pullRequests };
}

/**
 * Search for GitHub users by name (hybrid registry fallback).
 */
export async function searchUsers(
  query: string,
): Promise<GitHubUserSearchResult[]> {
  try {
    const data = (await githubFetch(
      `/search/users?q=${encodeURIComponent(query)}&per_page=5`,
    )) as { items?: Array<Record<string, unknown>> };

    return (data.items || []).map(
      (u): GitHubUserSearchResult => ({
        login: u["login"] as string,
        name: (u["name"] as string | null) || null,
        avatarUrl: (u["avatar_url"] as string) || "",
        profileUrl: (u["html_url"] as string) || "",
      }),
    );
  } catch {
    return [];
  }
}

/**
 * Fetch a specific user by their GitHub username.
 */
export async function getUserByUsername(
  username: string,
): Promise<GitHubUserSearchResult | null> {
  try {
    const u = (await githubFetch(
      `/users/${encodeURIComponent(username)}`,
    )) as Record<string, unknown>;

    return {
      login: u["login"] as string,
      name: (u["name"] as string | null) || null,
      avatarUrl: (u["avatar_url"] as string) || "",
      profileUrl: (u["html_url"] as string) || "",
    };
  } catch (err) {
    if (err instanceof GithubApiError && err.code === "GITHUB_NOT_FOUND") {
      return null;
    }
    throw err;
  }
}

/**
 * Check if GitHub is configured and accessible.
 */
export async function testConnection(): Promise<boolean> {
  try {
    await githubFetch("/user");
    return true;
  } catch {
    return false;
  }
}
