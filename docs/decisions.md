# Decisions & Rationale Log

> [!NOTE]
> This document tracks every significant technical decision made during the design and implementation of the Team Activity Monitor. Each entry includes the context, the decision, alternatives considered, and the rationale.

---

## D1: CLI-Only Interface (No Web UI)

| Aspect           | Detail                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | Build a CLI-based interactive chatbot only                                                                                                                                                                                                                                                                                                   |
| **Alternatives** | Simple HTML/CSS/JS web UI, TUI (Terminal UI) framework                                                                                                                                                                                                                                                                                       |
| **Rationale**    | The requirements allow CLI as an option. A CLI removes all frontend complexity (no HTTP server, no static assets, no CORS). This lets us dedicate the full 2-day sprint to rock-solid API integrations, smart query parsing, and polished AI responses — the areas worth the most points (Technical Implementation 50% + Functionality 30%). |
| **Trade-off**    | We lose "Bonus Points" for nice UI design, but gain time for deeper functionality and better error handling.                                                                                                                                                                                                                                 |

---

## D2: Node.js + TypeScript

| Aspect           | Detail                                                                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Decision**     | Use Node.js with TypeScript as the sole runtime and language                                                                                                                                                                                                                                                 |
| **Alternatives** | Python (Flask), plain JavaScript                                                                                                                                                                                                                                                                             |
| **Rationale**    | TypeScript gives us type safety for complex API responses (JIRA and GitHub payloads are deeply nested). It catches bugs at compile time that would otherwise surface during the demo. The evaluation explicitly values "clean, readable code structure" — TS interfaces serve as self-documenting contracts. |
| **Trade-off**    | Slightly more setup time vs. plain JS, but `ts-node` handles execution during development.                                                                                                                                                                                                                   |

---

## D3: Vercel AI SDK for Multi-Provider LLM Integration

| Aspect           | Detail                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Decision**     | Use the **Vercel AI SDK** (`ai` package + provider packages like `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/anthropic`) for LLM integration          |
| **Alternatives** | 1. **LangChain** — full orchestration framework 2. **Thin custom wrapper** — hand-rolled `switch` statement over raw SDKs 3. **Hardcode one provider** |
| **Rationale**    | See detailed comparison below                                                                                                                          |
| **Trade-off**    | Adds a dependency on the Vercel AI SDK ecosystem, but it's open-source, well-maintained, and TypeScript-first                                          |

### Why Vercel AI SDK over the alternatives?

**vs. LangChain:**
LangChain is a _comprehensive orchestration framework_ designed for complex multi-step workflows: chains, agents, RAG pipelines, vector stores, memory management. Our use case is simple — we send one prompt with context and get one response back. LangChain would add significant complexity (~101KB gzipped, steep learning curve, heavy abstraction layers) for zero benefit. It's like using a freight train to deliver a letter. If asked in the demo: _"We don't need chains, agents, or RAG. We have a single-shot prompt → response pattern. LangChain's value is in orchestration complexity; our AI usage is straightforward."_

**vs. Thin custom wrapper:**
A hand-rolled wrapper with `switch(provider)` and 3 adapter functions works, but it means:

- We maintain our own API integration code for each provider
- We handle error formats, retries, and streaming differences ourselves
- Every new provider requires writing a new adapter from scratch
- It doesn't demonstrate awareness of the ecosystem

**Why Vercel AI SDK wins:**

1. **Unified `generateText()` API** — One function call works with any provider. Switching from Gemini to OpenAI is a one-line config change, not a code change.
2. **TypeScript-first** — Full type safety, excellent IntelliSense. Matches our stack perfectly.
3. **Lightweight** — ~67KB gzipped. No heavy abstractions. It does one thing well: normalize LLM interactions.
4. **Provider packages** — `@ai-sdk/google` for Gemini, `@ai-sdk/openai` for GPT, `@ai-sdk/anthropic` for Claude. Each is a thin, official adapter.
5. **Industry standard** — Widely adopted in the Node.js ecosystem, actively maintained, well-documented.
6. **Future-proof** — Supports 25+ providers. If the team wants to add Ollama, Mistral, or any other provider, it's a package install away.

**Interview-ready explanation:**

> _"I chose the Vercel AI SDK because it sits at the right level of abstraction for our use case. LangChain is powerful but designed for complex orchestration — chains, RAG, multi-step agents — which we don't need. A custom wrapper would work but means maintaining our own API integration layer. The Vercel AI SDK gives us a single `generateText()` function that works identically across Gemini, OpenAI, and Claude, with full TypeScript support. It's the pragmatic middle ground: vendor-agnostic without over-engineering."_

---

## D4: Fuzzy Name Matching with Interactive Disambiguation

| Aspect           | Detail                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | Use fuzzy string matching (Levenshtein distance) to find the best user match. If confidence is high (>0.85), auto-select. If multiple close matches exist, present a numbered list and ask the user to pick.                                                                                                                                                         |
| **Alternatives** | Exact match only, ask the user every time                                                                                                                                                                                                                                                                                                                            |
| **Rationale**    | People will type "John" when the JIRA display name is "John Smith" or the GitHub username is "jsmith". Exact matching would fail constantly. Always asking is annoying. The hybrid approach (auto-select on high confidence, disambiguate on low) gives the best UX and demonstrates "creative solutions to technical challenges" (Evaluation: Problem-Solving 20%). |
| **Trade-off**    | Requires a lightweight fuzzy matching library (`fuse.js` or custom Levenshtein).                                                                                                                                                                                                                                                                                     |

---

## D5: Hybrid User Registry — Local File + API Fallback

| Aspect           | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | Use a **hybrid approach**: check the local `config.yaml` team registry first. If the user is not found, search the JIRA and GitHub APIs dynamically. On a successful match, persist the result back to the local registry for future lookups.                                                                                                                                                                                                                                      |
| **Alternatives** | Static config file only, dynamic search only, database                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Rationale**    | A purely static file requires manual maintenance every time a new team member is mentioned. A purely dynamic approach is slow and unreliable (JIRA user search needs specific scopes, GitHub name→username mapping is imprecise). The hybrid approach gives us the best of both: instant lookups for known members, graceful discovery for new ones, and a self-building registry that improves over time. This also demonstrates real API integration as the requirements expect. |
| **How it works** | 1. User asks about "Lisa" → check `config.yaml` team list 2. Not found → search JIRA user API (`/rest/api/3/user/search?query=Lisa`) 3. Search GitHub API (`/search/users?q=Lisa`) 4. Present candidates from both platforms, ask user to confirm 5. On confirmation, append the new member to `config.yaml` automatically 6. Next time "Lisa" is asked about, it's an instant local lookup                                                                                        |
| **Trade-off**    | More complex than a static file, but the self-building registry eliminates ongoing maintenance. The JIRA user search API may require appropriate permissions.                                                                                                                                                                                                                                                                                                                      |

---

## D6: Configurable Time Window for "Recent" Activity

| Aspect             | Detail                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Problem**        | The prompt asks for "recent activity" but doesn't define what "recent" means. Is it yesterday? Last week? Last month?                   |
| **Decision**       | Make the "recent activity" window **fully configurable** via `config.yaml`. Default to 7 days.                                          |
| **Rationale**      | Different teams have different cadence. Giving the user control prevents the CLI from becoming a black box that makes poor assumptions. |
| **Config example** | `jira.lookback_days: 7` and `github.lookback_days: 7` — these can be changed by the user at any time without touching code.             |
| **Trade-off**      | None significant. The config parsing already handles this; the JIRA client just reads the configured value.                             |

---

## D7: All JIRA Statuses Included

| Aspect           | Detail                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | Fetch issues in all statuses (To Do, In Progress, In Review, Done, etc.)                                                                                                                                                        |
| **Alternatives** | Only active statuses, only completed                                                                                                                                                                                            |
| **Rationale**    | User explicitly requested all statuses. This gives a complete picture: what someone finished, what they're actively doing, and what's queued up. The AI response can then intelligently group and summarize by status category. |
| **Trade-off**    | Potentially more data to process, but the configurable sprint/day window bounds it.                                                                                                                                             |

---

## D8: Configuration Strategy — `.env` + `config.yaml`

| Aspect           | Detail                                                                                                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | Use `.env` for secrets (API keys/tokens) and `config.yaml` for structured config (team members, JIRA project, GitHub repos, AI provider selection, time windows)                                                                                                            |
| **Alternatives** | Single `.env` file, JSON config, environment variables only                                                                                                                                                                                                                 |
| **Rationale**    | Secrets belong in `.env` (gitignored, standard practice). Structured data like user mappings and project lists are much more readable in YAML than in flat env vars. This split is a security best practice that the evaluation explicitly values ("no hardcoded secrets"). |
| **Trade-off**    | Two config files instead of one, but separation of concerns is worth it.                                                                                                                                                                                                    |

---

## D9: Clean Grouped Folder Structure

| Aspect           | Detail                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | Organize `src/` into logical subdirectories grouped by responsibility: `clients/` (API integrations), `core/` (business logic), `config/` (configuration), `types/` (shared types/schemas), and the CLI entry point at the root of `src/`                                                                                                                                                                 |
| **Alternatives** | Flat `src/` directory, deep feature-based nesting, 3-layer architecture                                                                                                                                                                                                                                                                                                                                   |
| **Rationale**    | A flat structure with 10+ files becomes hard to navigate and doesn't demonstrate architectural thinking. Deep nesting is over-engineering for a prototype. A **lightweight grouping by responsibility** strikes the right balance — clean enough to demonstrate good practices, readable at a glance, and slightly scalable if the project grows. The evaluation values "clean, readable code structure". |
| **Structure**    | See tech spec for full layout. Key groups: `src/clients/` for JIRA/GitHub/AI, `src/core/` for query parsing/user matching/response formatting, `src/config/` for config loading, `src/types/` for shared interfaces.                                                                                                                                                                                      |
| **Trade-off**    | Slightly more directory navigation than flat, but far more professional and readable.                                                                                                                                                                                                                                                                                                                     |

---

## D10: Error Handling Strategy

| Aspect           | Detail                                                                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | Use typed custom errors (`JiraApiError`, `GithubApiError`, `UserNotFoundError`) with a central error handler in the CLI loop                                                                                                                                                            |
| **Alternatives** | Generic try/catch everywhere, error codes                                                                                                                                                                                                                                               |
| **Rationale**    | Custom errors let us give specific, helpful messages ("Could not find user 'Jon' in JIRA. Did you mean 'John Smith'?"). The evaluation values "handles basic error scenarios" and "clear communication". A central handler in the REPL loop means no unhandled crashes during the demo. |
| **Trade-off**    | Slightly more boilerplate for error classes, but each is ~5 lines.                                                                                                                                                                                                                      |

---

## D11: Basic In-Memory Caching with TTL

| Aspect             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**       | Implement a simple in-memory cache with a configurable TTL (default: 5 minutes) for API responses                                                                                                                                                                                                                                                                                                                         |
| **Alternatives**   | No caching, Redis, file-based cache                                                                                                                                                                                                                                                                                                                                                                                       |
| **Rationale**      | During a demo or normal usage, the same person's activity is often queried multiple times (e.g., asking about JIRA first, then GitHub, then the combined view). Without caching, each query hits the APIs redundantly. A basic `Map<string, { data, expiry }>` pattern is ~30 lines of code, zero dependencies, and earns "Performance optimizations (caching)" bonus points. Redis is overkill for a single-process CLI. |
| **Implementation** | A simple `CacheManager` class wrapping a `Map` with TTL-based expiry. Cache key = `${service}:${userId}`. Invalidated automatically after TTL. No complex invalidation logic needed.                                                                                                                                                                                                                                      |
| **Trade-off**      | Slight risk of stale data within the TTL window, but 5 minutes is short enough for activity data. Users can always bypass the cache by restarting the app.                                                                                                                                                                                                                                                                |

---

## D12: Use `tsx` for Development, `tsc` for Final Build

| Aspect           | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | Use `tsx` for development and `tsc` + `node` for the final deliverable                                                                                                                                                                                                                                                                                                                                                                                           |
| **Alternatives** | `ts-node`, `esbuild`, `bun`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Rationale**    | During implementation, `ts-node` (v10) encountered module resolution issues (`ERR_MODULE_NOT_FOUND`) with ESM imports in the newer Node.js v25+ environment. `tsx` (based on esbuild) provides far more robust, zero-config support for ESM and newer Node versions. It solves the extension mapping issues seamlessly while being significantly faster than `ts-node`. For the final deliverable, a proper `tsc` build still ensures the code compiles cleanly. |
| **Trade-off**    | Moves away from the "standard" `ts-node` choice, but prioritized a working, stable development environment that doesn't break on modern Node versions.                                                                                                                                                                                                                                                                                                           |

---

## D13: Zod for Runtime Validation of API Responses

| Aspect           | Detail                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | Use Zod schemas to validate JIRA and GitHub API responses at runtime                                                                                                                                                                                                                                                                            |
| **Alternatives** | Trust the API responses, manual validation                                                                                                                                                                                                                                                                                                      |
| **Rationale**    | TypeScript types disappear at runtime. If JIRA returns an unexpected shape (field renamed, null where we expect a string), we'd get a cryptic `Cannot read property of undefined` during the demo. Zod catches this at the boundary with a clear error message. It also generates TypeScript types from schemas, so we write the contract once. |
| **Trade-off**    | Adds one dependency, but Zod is lightweight and zero-dep itself.                                                                                                                                                                                                                                                                                |

---

## D14: AI Hallucination Prevention — 4-Layer Defence

| Aspect                         | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**                   | Implement a 4-layer defence against AI hallucination: (1) grounded prompting with explicit constraints, (2) post-generation validation against source data, (3) retry with corrective feedback, (4) template fallback as last resort                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Alternatives**               | Trust the AI output, use structured output (JSON mode), use a separate fact-checking LLM call                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Rationale**                  | The AI summarizes _specific data_ — ticket numbers, PR titles, repo names. If it invents a ticket number like "PROJ-999" that doesn't exist, the user could waste time looking for it. We can't just trust the output. Structured JSON output would be an option, but it removes the "conversational" quality. A separate fact-checking LLM call doubles cost and latency. Instead, **post-generation regex-based validation** is cheap, fast, and deterministic — we extract all `[A-Z]+-\d+` (JIRA keys) and `#\d+` (PR numbers) from the response and cross-reference against the actual source data. If any don't match, we retry with corrective feedback appended to the prompt. If retries fail, we fall back to a template that mechanically lists the raw data — guaranteed 100% factual. |
| **Why not structured output?** | JSON mode forces a rigid schema and loses the natural conversational tone we want. The point of using AI is to generate a _human-readable summary_, not a data dump. We get the best of both: conversational AI output + programmatic fact-checking.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Trade-off**                  | Adds ~50 lines of validation code and potentially 1-2 extra AI calls on hallucination. But max retries (default 2) cap the latency, and the template fallback guarantees the demo never shows bad data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

---

## D15: AI-Powered Query Parsing with Regex Fallback

| Aspect             | Detail                                                                                                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**       | Use the **LLM (AI)** to parse natural language queries into structured `person` and `intent` data. If the AI call fails, use a secondary **Regex-based parser** as a fallback.                                                                                                      |
| **Rationale**      | Human language is complex and varied. Using regex alone makes the bot fragile (e.g., "what does Sarah is working on" would fail). AI handles conversational phrasing effortlessly. The regex fallback ensures the bot remains functional even in offline or rate-limited scenarios. |
| **Implementation** | Deterministic parsing using a system prompt with JSON-only output and temperature 0.                                                                                                                                                                                                |
| **Trade-off**      | Adds slight latency (~200-500ms) to the initial query processing, but the benefit of understanding any input far outweighs the delay.                                                                                                                                               |

---

## D16: Filtering 'Done' Issues by Default

| Aspect        | Detail                                                                                                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**  | Modify the JIRA query (JQL) to exclude issues in the `statusCategory = Done`.                                                                                                                                                                                        |
| **Rationale** | Evaluation feedback suggests prioritizing "active" or "in-progress" work. Completed issues clutter the summary and don't reflect current focus. By filtering these out at the API level, we reduce context window noise and improve the quality of the AI's summary. |
| **Trade-off** | Users who _specifically_ want to see what someone finished will not see those tickets, but for the primary use case of "what are they working on", this is a superior experience.                                                                                    |

## Summary of Key Trade-offs

| We Prioritize              | Over                       | Why                                                   |
| -------------------------- | -------------------------- | ----------------------------------------------------- |
| Functionality depth        | UI polish                  | 80% of evaluation is Technical + Functionality        |
| Type safety (TS + Zod)     | Speed of writing code      | Prevents demo-killing runtime errors                  |
| AI-Powered Parsing         | Rigid Regex Only           | Understanding natural, complex human queries          |
| Context focus (No 'Done')  | Raw data dump              | Summarizes what matters (active work)                 |
| Clean grouped structure    | Flat files                 | Demonstrates architectural thinking per eval criteria |
| Vercel AI SDK              | LangChain / custom wrapper | Right abstraction level — not too heavy, not too thin |
| Hybrid user registry       | Static-only config         | Self-building, demonstrates real API integration      |
| Configurable time window   | Hardcoded 7 days           | Flexibility for different use cases                   |
| Basic in-memory cache      | No cache                   | Low effort, earns bonus points                        |
| Modern developer stability | Standard tooling (ts-node) | Prioritizes working builds on latest Node versions    |
| Validated AI output        | Blind trust in LLM         | Prevents showing fabricated ticket/PR numbers         |
