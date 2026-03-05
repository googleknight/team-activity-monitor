/**
 * Custom error classes for the Team Activity Monitor.
 * Each error type maps to a specific failure domain for targeted handling.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** JIRA REST API failures (auth, permissions, network) */
export class JiraApiError extends AppError {
  constructor(message: string, code: string = "JIRA_ERROR") {
    super(message, code);
  }
}

/** GitHub REST API failures (auth, rate limit, not found) */
export class GithubApiError extends AppError {
  constructor(message: string, code: string = "GITHUB_ERROR") {
    super(message, code);
  }
}

/** AI provider failures (generation, validation) */
export class AIProviderError extends AppError {
  constructor(message: string, code: string = "AI_ERROR") {
    super(message, code);
  }
}

/** Team member not found in config or via API search */
export class UserNotFoundError extends AppError {
  constructor(name: string) {
    super(
      `I couldn't find anyone named '${name}' locally or via JIRA/GitHub. Type \`team\` to see configured members.`,
      "USER_NOT_FOUND",
    );
  }
}

/** Invalid or missing configuration */
export class ConfigError extends AppError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR");
  }
}
