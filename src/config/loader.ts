/**
 * Configuration loader.
 * Loads secrets from .env and structured config from config.yaml.
 * Validates everything with Zod schemas at startup.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  AppConfigSchema,
  type RawAppConfig,
  TeamMemberSchema,
} from "./schema.js";
import type { TeamMember } from "../types/activity.js";
import { ConfigError } from "../types/errors.js";

/** Resolved application configuration with env secrets merged in */
export interface AppConfig {
  ai: {
    provider: "gemini" | "openai" | "claude";
    model: string;
    temperature: number;
    maxRetries: number;
    validateResponse: boolean;
  };
  jira: {
    baseUrl: string;
    email: string;
    apiToken: string;
    projectKeys: string[];
    boardId: number;
    lookbackSprints: number;
    lookbackDays: number;
    lookbackMode: "sprints" | "days";
  };
  github: {
    token: string;
    repos: string[];
    lookbackDays: number;
  };
  cache: {
    enabled: boolean;
    ttlMinutes: number;
  };
  team: TeamMember[];
}

const CONFIG_PATH = resolve(process.cwd(), "config.yaml");

let _config: AppConfig | null = null;
let _rawYaml: RawAppConfig | null = null;

/**
 * Load and validate configuration from .env + config.yaml.
 * Exits with a clear error if required config is missing.
 */
export function loadConfig(): AppConfig {
  // Load .env
  dotenv.config();

  // Read config.yaml
  if (!existsSync(CONFIG_PATH)) {
    throw new ConfigError(
      `config.yaml not found at ${CONFIG_PATH}. Copy config.yaml.example to config.yaml and update the values.`,
    );
  }

  const rawContent = readFileSync(CONFIG_PATH, "utf-8");
  const rawYaml = parseYaml(rawContent);

  // Validate with Zod
  const parseResult = AppConfigSchema.safeParse(rawYaml);
  if (!parseResult.success) {
    const errors = parseResult.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid config.yaml:\n${errors}`);
  }

  _rawYaml = parseResult.data;

  // Validate env vars
  const jiraBaseUrl = process.env["JIRA_BASE_URL"] || "";
  const jiraEmail = process.env["JIRA_EMAIL"] || "";
  const jiraApiToken = process.env["JIRA_API_TOKEN"] || "";
  const githubToken = process.env["GITHUB_TOKEN"] || "";
  const aiApiKey = process.env["AI_API_KEY"] || "";

  // Warn but don't fail for missing env vars — user might not have them yet
  if (!jiraBaseUrl)
    console.warn(
      "⚠️  JIRA_BASE_URL not set in .env — JIRA features will be unavailable",
    );
  if (!githubToken)
    console.warn(
      "⚠️  GITHUB_TOKEN not set in .env — GitHub features will be unavailable",
    );
  if (!aiApiKey)
    console.warn(
      "⚠️  AI_API_KEY not set in .env — AI summaries will fall back to templates",
    );

  // Set AI_API_KEY as the provider-specific env var too
  // Vercel AI SDK looks for GOOGLE_GENERATIVE_AI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY
  if (aiApiKey) {
    const providerEnvMap: Record<string, string> = {
      gemini: "GOOGLE_GENERATIVE_AI_API_KEY",
      openai: "OPENAI_API_KEY",
      claude: "ANTHROPIC_API_KEY",
    };
    const envKey = providerEnvMap[parseResult.data.ai.provider];
    if (envKey && !process.env[envKey]) {
      process.env[envKey] = aiApiKey;
    }
  }

  const config: AppConfig = {
    ai: {
      provider: parseResult.data.ai.provider,
      model: parseResult.data.ai.model,
      temperature: parseResult.data.ai.temperature,
      maxRetries: parseResult.data.ai.max_retries,
      validateResponse: parseResult.data.ai.validate_response,
    },
    jira: {
      baseUrl: jiraBaseUrl.replace(/\/$/, ""), // Remove trailing slash
      email: jiraEmail,
      apiToken: jiraApiToken,
      projectKeys: parseResult.data.jira.project_keys,
      boardId: parseResult.data.jira.board_id,
      lookbackSprints: parseResult.data.jira.lookback_sprints,
      lookbackDays: parseResult.data.jira.lookback_days,
      lookbackMode: parseResult.data.jira.lookback_mode,
    },
    github: {
      token: githubToken,
      repos: parseResult.data.github.repos,
      lookbackDays: parseResult.data.github.lookback_days,
    },
    cache: {
      enabled: parseResult.data.cache.enabled,
      ttlMinutes: parseResult.data.cache.ttl_minutes,
    },
    team: parseResult.data.team.map((t) => ({
      name: t.name,
      jiraAccountId: t.jira_account_id,
      githubUsername: t.github_username,
    })),
  };

  _config = config;
  return config;
}

/**
 * Get the current loaded config. Throws if not loaded yet.
 */
export function getConfig(): AppConfig {
  if (!_config) {
    throw new ConfigError("Configuration not loaded. Call loadConfig() first.");
  }
  return _config;
}

/**
 * Persist a newly discovered team member to config.yaml.
 */
export function persistTeamMember(member: TeamMember): void {
  if (!_rawYaml) {
    throw new ConfigError("Cannot persist member — config not loaded.");
  }

  // Check for duplicates
  const exists = _rawYaml.team.some(
    (t) =>
      t.jira_account_id === member.jiraAccountId ||
      t.github_username === member.githubUsername,
  );
  if (exists) return;

  // Add to raw yaml
  const rawMember = {
    name: member.name,
    jira_account_id: member.jiraAccountId,
    github_username: member.githubUsername,
  };

  // Validate before adding
  TeamMemberSchema.parse(rawMember);
  _rawYaml.team.push(rawMember);

  // Add to runtime config
  _config?.team.push(member);

  // Write back to config.yaml
  writeFileSync(CONFIG_PATH, stringifyYaml(_rawYaml), "utf-8");
}
