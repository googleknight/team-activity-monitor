/**
 * CLI — Interactive REPL for the Team Activity Monitor.
 * Handles user I/O, special commands, and disambiguation prompts.
 */

import { createInterface, type Interface } from "node:readline";
import chalk from "chalk";
import ora from "ora";
import { getConfig } from "./config/loader.js";
import {
  processQuery,
  clearCache,
  init as initOrchestrator,
} from "./core/orchestrator.js";
import { sanitizeInput } from "./core/query-parser.js";
import { getTeam } from "./core/user-matcher.js";
import type { TeamMember } from "./types/activity.js";

const BANNER = `
${chalk.bold.cyan("┌─────────────────────────────────────────────┐")}
${chalk.bold.cyan("│")}         ${chalk.bold("🔍 Team Activity Monitor")}            ${chalk.bold.cyan("│")}
${chalk.bold.cyan("│")}    ${chalk.dim("Ask me about your team's activity!")}       ${chalk.bold.cyan("│")}
${chalk.bold.cyan("│")}                                             ${chalk.bold.cyan("│")}
${chalk.bold.cyan("│")}  ${chalk.dim("Type")} ${chalk.yellow("help")} ${chalk.dim("for usage,")} ${chalk.yellow("quit")} ${chalk.dim("to exit")}     ${chalk.bold.cyan("│")}
${chalk.bold.cyan("└─────────────────────────────────────────────┘")}
`;

const HELP_TEXT = `
${chalk.bold("📖 Usage")}
${chalk.dim("━".repeat(40))}

${chalk.bold("Example queries:")}
  ${chalk.cyan('"What is John working on?"')}
  ${chalk.cyan('"Show me recent activity for Sarah"')}
  ${chalk.cyan('"What JIRA tickets is John working on?"')}
  ${chalk.cyan('"Show me Lisa\'s recent pull requests"')}
  ${chalk.cyan('"What has Mike committed this week?"')}

${chalk.bold("Special commands:")}
  ${chalk.yellow("help")}         — Show this help message
  ${chalk.yellow("team")}         — List configured team members
  ${chalk.yellow("config")}       — Show current configuration
  ${chalk.yellow("clear-cache")}  — Clear the in-memory cache
  ${chalk.yellow("exit / quit")}  — Exit the application
`;

/**
 * Start the interactive REPL.
 */
export async function startCLI(): Promise<void> {
  initOrchestrator();

  console.log(BANNER);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green("You: "),
  });

  // Handle Ctrl+C gracefully
  rl.on("close", () => {
    console.log(chalk.dim("\n👋 Goodbye!\n"));
    process.exit(0);
  });

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      continue;
    }

    // Handle special commands
    if (await handleSpecialCommand(input, rl)) {
      rl.prompt();
      continue;
    }

    // SECURITY: Pre-check for blocked inputs and show a friendly message
    const sanitized = sanitizeInput(input);
    if ("blocked" in sanitized) {
      console.log(chalk.yellow(`\n🚫 ${sanitized.reason}\n`));
      rl.prompt();
      continue;
    }

    // Process the query with a spinner
    const spinner = ora({
      text: "Thinking...",
      color: "cyan",
    }).start();

    try {
      const result = await processQuery(input, (candidates, query) =>
        disambiguate(rl, candidates, query, spinner),
      );

      spinner.stop();
      console.log(result);
    } catch (err) {
      spinner.stop();
      if (err instanceof Error) {
        console.log(chalk.red(`\n❌ Error: ${err.message}\n`));
      } else {
        console.log(chalk.red(`\n❌ An unexpected error occurred.\n`));
      }
    }

    rl.prompt();
  }
}

/**
 * Handle special commands (help, team, config, etc).
 * Returns true if the input was a special command.
 */
async function handleSpecialCommand(
  input: string,
  rl: Interface,
): Promise<boolean> {
  const cmd = input.toLowerCase();

  switch (cmd) {
    case "help":
      console.log(HELP_TEXT);
      return true;

    case "team":
      showTeam();
      return true;

    case "config":
      showConfig();
      return true;

    case "clear-cache":
      clearCache();
      console.log(chalk.green("\n✅ Cache cleared.\n"));
      return true;

    case "exit":
    case "quit":
      console.log(chalk.dim("\n👋 Goodbye!\n"));
      process.exit(0);

    default:
      return false;
  }
}

/**
 * Display configured team members.
 */
function showTeam(): void {
  const team = getTeam();

  console.log("");
  console.log(chalk.bold("📋 Configured Team Members"));
  console.log(chalk.dim("━".repeat(40)));

  if (team.length === 0) {
    console.log(chalk.dim("  No team members configured yet."));
    console.log(
      chalk.dim(
        "  Ask about someone and I'll search JIRA/GitHub to find them.",
      ),
    );
  } else {
    for (let i = 0; i < team.length; i++) {
      const m = team[i]!;
      const jira = m.jiraAccountId
        ? chalk.dim(`JIRA: ${m.jiraAccountId.substring(0, 8)}..`)
        : chalk.dim("JIRA: —");
      const gh = m.githubUsername
        ? chalk.dim(`GitHub: ${m.githubUsername}`)
        : chalk.dim("GitHub: —");
      console.log(`  ${i + 1}. ${chalk.bold(m.name)}  (${jira} | ${gh})`);
    }
  }
  console.log("");
}

/**
 * Display current configuration (secrets redacted).
 */
function showConfig(): void {
  const config = getConfig();

  console.log("");
  console.log(chalk.bold("⚙️  Current Configuration"));
  console.log(chalk.dim("━".repeat(40)));

  console.log(
    `  AI Provider:  ${chalk.cyan(config.ai.provider)} (${config.ai.model})`,
  );
  console.log(`  Temperature:  ${config.ai.temperature}`);
  console.log(
    `  Validation:   ${config.ai.validateResponse ? chalk.green("enabled") : chalk.red("disabled")}`,
  );
  console.log(`  Max Retries:  ${config.ai.maxRetries}`);
  console.log("");
  console.log(
    `  JIRA URL:     ${config.jira.baseUrl ? chalk.cyan(config.jira.baseUrl) : chalk.dim("not set")}`,
  );
  console.log(
    `  JIRA Projects:${chalk.cyan(` ${config.jira.projectKeys.join(", ")}`)}`,
  );
  console.log(`  Lookback:     ${config.jira.lookbackDays} days`);
  console.log("");
  console.log(`  GitHub Repos: ${chalk.cyan(config.github.repos.join(", "))}`);
  console.log(`  GH Lookback:  ${config.github.lookbackDays} days`);
  console.log("");
  console.log(
    `  Cache:        ${config.cache.enabled ? chalk.green(`enabled (${config.cache.ttlMinutes}min TTL)`) : chalk.red("disabled")}`,
  );
  console.log(`  Team Members: ${config.team.length}`);
  console.log("");
}

/**
 * Prompt the user to pick from a list of candidates for disambiguation.
 * Pauses the spinner, asks for input, resumes.
 */
async function disambiguate(
  rl: Interface,
  candidates: TeamMember[],
  originalQuery: string,
  spinner: ReturnType<typeof ora>,
): Promise<TeamMember | null> {
  spinner.stop();

  console.log("");
  console.log(chalk.yellow(`I found multiple matches for "${originalQuery}":`));
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const details: string[] = [];
    if (c.jiraAccountId)
      details.push(`JIRA: ${c.jiraAccountId.substring(0, 12)}..`);
    if (c.githubUsername) details.push(`GitHub: ${c.githubUsername}`);
    const detailStr =
      details.length > 0 ? chalk.dim(` (${details.join(" | ")})`) : "";
    console.log(`  ${chalk.bold(`${i + 1}.`)} ${c.name}${detailStr}`);
  }
  console.log(`  ${chalk.bold("0.")} ${chalk.dim("Cancel")}`);

  return new Promise((resolve) => {
    rl.question(chalk.green("\nPlease enter the number: "), (answer) => {
      const num = parseInt(answer.trim(), 10);
      if (num === 0 || isNaN(num) || num < 0 || num > candidates.length) {
        console.log(chalk.dim("Cancelled."));
        resolve(null);
      } else {
        const selected = candidates[num - 1]!;
        console.log(chalk.green(`✅ Selected: ${selected.name}`));
        spinner.start(`Fetching activity for ${selected.name}...`);
        resolve(selected);
      }
    });
  });
}
