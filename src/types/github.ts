/**
 * GitHub data models and types.
 */

export interface GitHubCommit {
  sha: string;
  message: string;
  date: Date;
  repo: string;
  url: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  repo: string;
  createdAt: Date;
  mergedAt?: Date;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface GitHubActivity {
  commits: GitHubCommit[];
  pullRequests: GitHubPR[];
}

export interface GitHubUserSearchResult {
  login: string;
  name: string | null;
  avatarUrl: string;
  profileUrl: string;
}
