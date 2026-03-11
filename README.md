# Team Activity Monitor

A CLI chatbot that answers questions like _"What is [member] working on?"_ by fetching and combining data from JIRA and GitHub, then generating a human-readable summary using a configurable AI provider.

## Demo

Click to play the demo video: [![Team Activity Monitor Demo](/docs/screenshot.png)](https://drive.google.com/file/d/1fVr3FVYpp3dyBZGYQGbb4OJofjOH698p/view?usp=sharing)

## Quick Start

### Prerequisites

- **Node.js** 20+ (LTS)
- API keys for your services (see below)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the example files and fill in your values:

```bash
cp .env.example .env
cp config.yaml.example config.yaml
```

Edit `.env` with your API secrets:

```bash
# .env
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your-jira-api-token
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
AI_API_KEY=your-gemini-api-key
```

Edit `config.yaml` with your project settings:

```yaml
ai:
  provider: "gemini" # gemini | openai | claude
  model: "gemini-2.0-flash"

jira:
  project_keys: ["YOUR-PROJECT"]
  lookback_days: 7

github:
  repos: ["your-org/your-repo"]
  lookback_days: 7

team: [] # Will auto-populate as you use the app
```

### 3. Run Smoke Test

Verify your configuration:

```bash
npm run smoke-test
```

### 4. Start the App

```bash
npm run dev
```

## Usage

### Example Queries

```
What is John working on?
Show me recent activity for Sarah
What JIRA tickets is John working on?
Show me Lisa's recent pull requests
What has Mike committed this week?
Who all worked on GitHub this week? (Team-wide)
Show me team activity (Team-wide)
```

### Special Commands

| Command         | Description                   |
| --------------- | ----------------------------- |
| `help`          | Show usage and examples       |
| `team`          | List configured team members  |
| `config`        | Show current configuration    |
| `clear-cache`   | Clear the in-memory API cache |
| `exit` / `quit` | Exit the application          |

### User Discovery

When you ask about someone who isn't in `config.yaml`, the app will:

1. Search JIRA and GitHub APIs for matching users
2. Present candidates for you to confirm
3. Automatically save the confirmed member to `config.yaml`

Next time you ask about the same person, it's an instant local lookup.

## Architecture

```
src/
├── clients/           # External API integrations
│   ├── jira-client    # JIRA REST API (issues, sprints, user search)
│   ├── github-client  # GitHub REST API (commits, PRs, user search)
│   └── ai-client      # Vercel AI SDK (Gemini/OpenAI/Claude)
├── core/              # Business logic
│   ├── query-parser   # AI-powered intent + entity extraction (with regex fallback)
│   ├── user-matcher   # Fuzzy matching + API discovery
│   ├── cache-manager  # In-memory TTL cache
│   ├── response-formatter  # Format for AI + terminal
│   └── orchestrator   # Main pipeline (parse → match → fetch → generate)
├── config/            # Configuration management
│   ├── loader         # Config loader + Zod validation
│   └── schema         # Zod schemas
├── types/             # Shared TypeScript types
├── cli.ts             # Interactive REPL
└── index.ts           # Entry point
```

## Key Technical Decisions

- **Vercel AI SDK** for LLM integration — unified `generateText()` across providers
- **Hallucination prevention** — 4-layer defence (grounded prompting, post-generation validation, retry with corrective feedback, template fallback)
- **Hybrid user registry** — local config + API discovery with auto-persist
- **Zod validation** — runtime type safety for config and API responses

See `docs/FEATURES_AND_SAFEGUARDS.md` for a comprehensive list of features and security safeguards.
See `docs/decisions.md` for the full rationale behind each decision.

## Building for Production

```bash
npm run build    # Compiles TypeScript to dist/
npm start        # Runs the compiled version
```

## License

MIT
