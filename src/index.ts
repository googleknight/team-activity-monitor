/**
 * Entry point — Bootstrap config, then start the CLI.
 */

import { loadConfig } from "./config/loader.js";
import { startCLI } from "./cli.js";
import { ConfigError } from "./types/errors.js";
import chalk from "chalk";

async function main(): Promise<void> {
  try {
    // Load and validate configuration
    loadConfig();

    // Start the interactive CLI
    await startCLI();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(chalk.red(`\n❌ Configuration Error: ${err.message}\n`));
      process.exit(1);
    }

    console.error(
      chalk.red(
        `\n❌ Fatal Error: ${err instanceof Error ? err.message : String(err)}\n`,
      ),
    );
    process.exit(1);
  }
}

main();
