# Running Different Models

## Overview

thepopebot has two layers that use LLMs independently:

- **Event Handler** — powers web chat, Telegram responses, webhook processing, and job summaries. Configured via the admin UI.
- **Coding Agents** — Docker containers for code workspaces and agent jobs (Claude Code, Pi, etc.). Configured separately via the admin UI.

Because these are independent, you can run a capable model for interactive chat and a different model for coding tasks — or vice versa.

All LLM configuration is managed through the admin UI. The `.env` file is only used for initial bootstrapping — values migrate to the database on first startup.

## Configuring the Chat Model

Two LLMs sit on the event-handler side, each independently configured:

- **Live chat LLM** — drives streaming chat in the browser and Telegram. For agents with an SDK adapter (Claude Code today) the chat runs in-process; for everyone else the chat runs in an ephemeral headless container. The model selection rides with the coding agent (see [Coding Agents](CODING_AGENTS.md)) — there's no separate "chat model" slot anymore.
- **Helper LLM** — short one-shot completions used by the event handler itself: chat auto-titles, agent-job titles, PR-merge summaries. Configured at **Admin > Event Handler > Helper LLM** (`/admin/event-handler/helper-llm`).

Add provider API keys at **Admin > Event Handler > LLMs** (`/admin/event-handler/llms`). The same keys back both layers.

`LLM_MAX_TOKENS` defaults to 4096.

## Configuring Coding Agent Models

The coding agent (code workspaces, agent jobs) can use a different provider and model from the chat layer. Configure at **Admin > Event Handler > Coding Agents**.

See [CODING_AGENTS.md](CODING_AGENTS.md) for details.

## Per-Job Overrides

Agent-type entries in `agent-job/CRONS.json` and actions in `event-handler/TRIGGERS.json` accept two optional override fields:

- **`agent_backend`** — pick which coding agent runs the job, overriding the default set in Admin > Event Handler > Coding Agents. Values: `claude-code`, `codex-cli`, `gemini-cli`, `pi-coding-agent`, `opencode`, `kimi-cli`. The provider is implicit in the agent (e.g. `codex-cli` → OpenAI, `gemini-cli` → Google).
- **`llm_model`** — override the model used within the selected coding agent. The value must be a model the chosen agent supports (e.g. `claude-opus-4-7` for Claude Code, `gpt-5.4` for Codex).

```json
{
  "name": "Code review",
  "schedule": "0 9 * * 1",
  "type": "agent",
  "job": "Review open PRs and leave comments",
  "agent_backend": "codex-cli",
  "llm_model": "gpt-5.4"
}
```

The coding agent must be enabled in the admin UI before an override can select it.

## Provider Reference

| Provider | `LLM_PROVIDER` value | Default Model | API Key Variable |
|----------|---------------------|---------------|------------------|
| Anthropic | `anthropic` (default) | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `gpt-5.4` | `OPENAI_API_KEY` |
| Google | `google` | `gemini-2.5-flash` | `GOOGLE_API_KEY` |
| DeepSeek | `deepseek` | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| MiniMax | `minimax` | `MiniMax-M2.7` | `MINIMAX_API_KEY` |
| Mistral | `mistral` | `mistral-large-latest` | `MISTRAL_API_KEY` |
| xAI | `xai` | `grok-4.20-0309-non-reasoning` | `XAI_API_KEY` |
| Kimi | `kimi` | `kimi-k2.5` | `MOONSHOT_API_KEY` |
| OpenRouter | `openrouter` | (user-specified) | `OPENROUTER_API_KEY` |
| Custom | (user-defined) | (user-defined) | (user-defined) |

**Provider notes:**

- **Google Gemini**: `gemini-2.5-pro` and `gemini-3.*` "thinking" models auto-fallback to `gemini-2.5-flash` for the helper LLM (the helper layer doesn't tolerate the thinking-token output). They work fine as coding agent models.
- **OpenRouter**: No pre-defined model list — type in the model ID you want (e.g. `anthropic/claude-sonnet-4-6`).

## Adding Custom Providers

Custom providers let you connect any OpenAI-compatible API. Add them via **Admin > Event Handler > LLMs**. Each custom provider supports:

- Multiple models
- A base URL
- An optional API key

This works for DeepSeek, Ollama, Together AI, LM Studio, vLLM, Fireworks, and any other OpenAI-compatible endpoint.

## Local Models (Ollama, LM Studio, vLLM)

For models running on your host machine, use Docker networking to reach them from containers:

```
http://host.docker.internal:11434/v1
```

Set this as the base URL when adding a custom provider in the admin UI. Most local servers don't require an API key.

> **Why `host.docker.internal`?** thepopebot runs inside Docker containers, so `localhost` refers to the container itself. `host.docker.internal` routes to the host machine where your local model server is running.

## Quick Reference

| What | Where to configure |
|------|--------------------|
| Helper LLM (auto-titles, summaries) | Admin > Event Handler > Helper LLM |
| API keys and providers | Admin > Event Handler > LLMs |
| Coding agent model (live chat, workspaces, jobs) | Admin > Event Handler > Coding Agents |
| Per-job override | `agent_backend` + `llm_model` in `agent-job/CRONS.json` or `event-handler/TRIGGERS.json` |
| Custom provider (cloud) | Admin > Event Handler > LLMs > Add custom provider with base URL |
| Custom provider (local) | Same as above, use `http://host.docker.internal:<port>/v1` as base URL |
