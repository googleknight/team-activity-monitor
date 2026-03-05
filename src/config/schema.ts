/**
 * Zod schemas for validating config.yaml and .env values.
 */

import { z } from "zod";

export const TeamMemberSchema = z.object({
  name: z.string().min(1),
  jira_account_id: z.string().min(1),
  github_username: z.string().min(1),
});

export const AIConfigSchema = z.object({
  provider: z.enum(["gemini", "openai", "claude"]),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.3),
  max_retries: z.number().int().min(0).max(5).default(2),
  validate_response: z.boolean().default(true),
});

export const JiraConfigSchema = z.object({
  project_keys: z.array(z.string().min(1)).min(1),
  board_id: z.number().int().default(0),
  lookback_sprints: z.number().int().min(1).default(4),
  lookback_days: z.number().int().min(1).default(56),
  lookback_mode: z.enum(["sprints", "days"]).default("days"),
});

export const GithubConfigSchema = z.object({
  repos: z.array(z.string().min(1)).min(1),
  lookback_days: z.number().int().min(1).default(56),
});

export const CacheConfigSchema = z.object({
  enabled: z.boolean().default(true),
  ttl_minutes: z.number().min(1).default(5),
});

export const AppConfigSchema = z.object({
  ai: AIConfigSchema,
  jira: JiraConfigSchema,
  github: GithubConfigSchema,
  cache: CacheConfigSchema,
  team: z.array(TeamMemberSchema).default([]),
});

export type RawAppConfig = z.infer<typeof AppConfigSchema>;
export type RawTeamMember = z.infer<typeof TeamMemberSchema>;
