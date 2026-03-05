/**
 * Smoke Test — Validates configuration and API connectivity.
 * Run: npm run smoke-test
 */

import { loadConfig, getConfig } from "../src/config/loader.js";
import * as jiraClient from "../src/clients/jira-client.js";
import * as githubClient from "../src/clients/github-client.js";
import * as aiClient from "../src/clients/ai-client.js";
import chalk from "chalk";

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

async function runTests(): Promise<void> {
  console.log(chalk.bold("\n🧪 Smoke Test — Team Activity Monitor\n"));
  console.log(chalk.dim("━".repeat(50)));

  const results: TestResult[] = [];

  // Test 1: Config loading
  try {
    loadConfig();
    results.push({
      name: "Config Loading",
      passed: true,
      message: "config.yaml loaded and validated",
    });
  } catch (err) {
    results.push({
      name: "Config Loading",
      passed: false,
      message: err instanceof Error ? err.message : String(err),
    });
    // Can't continue without config
    printResults(results);
    return;
  }

  const config = getConfig();

  // Test 2: JIRA connection
  if (config.jira.baseUrl && config.jira.apiToken) {
    const jiraOk = await jiraClient.testConnection();
    results.push({
      name: "JIRA Connection",
      passed: jiraOk,
      message: jiraOk
        ? `Connected to ${config.jira.baseUrl}`
        : "Failed to connect — check credentials",
    });
  } else {
    results.push({
      name: "JIRA Connection",
      passed: false,
      message: "Not configured (JIRA_BASE_URL / JIRA_API_TOKEN missing)",
    });
  }

  // Test 3: GitHub connection
  if (config.github.token) {
    const ghOk = await githubClient.testConnection();
    results.push({
      name: "GitHub Connection",
      passed: ghOk,
      message: ghOk
        ? "Connected to GitHub API"
        : "Failed to connect — check GITHUB_TOKEN",
    });
  } else {
    results.push({
      name: "GitHub Connection",
      passed: false,
      message: "Not configured (GITHUB_TOKEN missing)",
    });
  }

  // Test 4: AI provider connection
  try {
    const aiOk = await aiClient.testConnection();
    results.push({
      name: `AI Provider (${config.ai.provider})`,
      passed: aiOk,
      message: aiOk
        ? `${config.ai.provider}/${config.ai.model} responding`
        : "Failed — check AI_API_KEY",
    });
  } catch (err) {
    results.push({
      name: `AI Provider (${config.ai.provider})`,
      passed: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Test 5: Team members
  results.push({
    name: "Team Members",
    passed: config.team.length > 0,
    message:
      config.team.length > 0
        ? `${config.team.length} member(s) configured`
        : "No members configured (they can be discovered at runtime)",
  });

  printResults(results);
}

function printResults(results: TestResult[]): void {
  console.log("");
  for (const r of results) {
    const icon = r.passed ? chalk.green("✅") : chalk.red("❌");
    console.log(
      `  ${icon} ${chalk.bold(r.name)}: ${r.passed ? chalk.green(r.message) : chalk.red(r.message)}`,
    );
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log("");
  console.log(chalk.dim("━".repeat(50)));
  console.log(`  ${chalk.bold(`${passed}/${total} checks passed`)}`);

  if (passed < total) {
    console.log(
      chalk.yellow(
        "\n  Some checks failed. This is OK if you haven't configured those services yet.",
      ),
    );
    console.log(
      chalk.yellow(
        "  The app will gracefully handle missing services at runtime.\n",
      ),
    );
  } else {
    console.log(
      chalk.green("\n  All systems go! Run `npm run dev` to start. 🚀\n"),
    );
  }
}

runTests().catch(console.error);
