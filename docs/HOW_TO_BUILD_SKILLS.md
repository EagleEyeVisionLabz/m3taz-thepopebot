# How to Build Skills

## What is a skill?

A skill is a folder containing a `SKILL.md` file and optionally script files. The agent teaches itself how to use them by reading the SKILL.md, then runs the scripts via bash. No new tools are registered. No TypeScript. No build step.

Skills work with all coding agents — they share the same `skills/` activation surface via agent-specific symlink bridges (`.claude/skills`, `.pi/skills`, etc.).

---

## Where skills live

Two directories, by design:

- **`skills-library/<name>/`** — canonical source. All `SKILL.md` files and scripts live here.
- **`skills/<name>`** — activation surface. Each entry is a symlink to `../skills-library/<name>`. Only skills symlinked here are visible to agents.

Activation is a symlink. Deactivation is removing the symlink. The skill source in `skills-library/` survives untouched.

```bash
# Activate
ln -s ../skills-library/my-skill skills/my-skill

# Deactivate (source preserved)
rm skills/my-skill
```

`npx thepopebot init` creates activation symlinks for all bundled skills **only on first install**. On subsequent upgrades, new bundled skills land in `skills-library/` un-activated — opt in by creating the symlink.

---

## How skills load

On-demand (progressive disclosure). At system-prompt build time, the renderer scans `skills/` (following symlinks into `skills-library/`) and puts **only the name + description** from each SKILL.md frontmatter into the system prompt. The full instructions are NOT loaded until the agent decides the skill is relevant and reads the file.

**The complete runtime flow** (using brave-search as example):

1. Renderer scans `skills/`, follows the `brave-search` symlink into `skills-library/brave-search/SKILL.md`, puts description in system prompt
2. User says "search for python async tutorials"
3. Agent sees the description, decides brave-search is relevant
4. Agent reads the full SKILL.md to learn the commands
5. Agent runs: `skills/brave-search/search.js "python async tutorials"` (the symlinked path)
6. `search.js` runs as a child process, reads `$BRAVE_API_KEY` from the environment, calls the Brave Search API, prints results to stdout
7. Agent reads results, responds to user

---

## What's inside a skill folder

Real example: brave-search (lives in `skills-library/brave-search/`, activated via `skills/brave-search → ../skills-library/brave-search`)

```
skills-library/brave-search/
├── SKILL.md          ← instructions for both agent and human
├── package.json      ← declares npm dependencies
├── search.js         ← Node.js script that calls Brave Search API, prints results to stdout
└── content.js        ← Node.js script that fetches a URL, extracts readable markdown
```

**SKILL.md contents**:
```markdown
---
name: brave-search
description: Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content.
---
# Brave Search

## Setup
cd skills/brave-search && npm install

## Search
skills/brave-search/search.js "query"              # Basic search (5 results)
skills/brave-search/search.js "query" -n 10        # More results (max 20)
skills/brave-search/search.js "query" --content    # Include page content as markdown
skills/brave-search/search.js "query" --freshness pw  # Results from last week

## Extract Page Content
skills/brave-search/content.js https://example.com
```

Skills use project-root-relative paths (e.g., `skills/brave-search/search.js`).

**Setup**: Run `npm install` once in the skill directory. The `package.json` declares what dependencies the scripts need. In Docker, dependencies are installed automatically by the entrypoint.

**The skill IS the bundle** — the SKILL.md, the code files, and the package.json all live in one directory.

---

## SKILL.md format

```markdown
---
name: skill-name-in-kebab-case
description: One sentence describing what the skill does and when to use it.
---

# Skill Name

## Usage

```bash
skills/skill-name/script.sh <args>
```
```

- **`name`** — kebab-case, matches the folder name
- **`description`** — appears in the system prompt under "Active skills"
- **Body** — full usage instructions the agent reads on-demand

Use project-root-relative paths in all examples (e.g., `skills/skill-name/script.sh`).

---

## Activation

Skills are active when there is a symlink from `skills/<name>` into `skills-library/<name>`. To deactivate, `rm skills/<name>` — the symlink goes away, the source files in `skills-library/` survive.

All coding agents discover active skills from the same `skills/` directory via symlink bridges (`.claude/skills → ../skills`, `.pi/skills → ../skills`, etc.). The bridges target `skills/`, so toggling activation in one place affects every agent.

---

## Building a new skill

### Simple bash skill (most common pattern)

Create the source files in `skills-library/`, then symlink to activate.

**skills-library/transcribe/SKILL.md:**
```markdown
---
name: transcribe
description: Speech-to-text transcription using Groq Whisper API. Supports m4a, mp3, wav, ogg, flac, webm.
---

# Transcribe

Speech-to-text using Groq Whisper API.

## Setup
Requires GROQ_API_KEY environment variable.

## Usage
```bash
skills/transcribe/transcribe.sh <audio-file>
```
```

**skills-library/transcribe/transcribe.sh:**
```bash
#!/bin/bash
if [ -z "$1" ]; then echo "Usage: transcribe.sh <audio-file>"; exit 1; fi
if [ -z "$GROQ_API_KEY" ]; then echo "Error: GROQ_API_KEY not set"; exit 1; fi
curl -s -X POST "https://api.groq.com/openai/v1/audio/transcriptions" \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -F "file=@${1}" \
  -F "model=whisper-large-v3-turbo" \
  -F "response_format=text"
```

Activate:

```bash
chmod +x skills-library/transcribe/transcribe.sh
ln -s ../skills-library/transcribe skills/transcribe
```

The agent invokes `skills/transcribe/transcribe.sh` (the symlinked path); use that path in SKILL.md.

### Skill with Node.js dependencies

The built-in `brave-search` skill uses Node.js for HTML parsing (jsdom, readability, turndown). It has a `package.json` and `.js` scripts. Dependencies are installed automatically in Docker. Use this pattern only when bash + curl isn't sufficient.

---

## Default skills

Skills are bundled in `templates/skills-library/` and scaffolded into user projects by `npx thepopebot init`. On first install they are auto-activated via symlinks in `skills/`; on subsequent upgrades new bundled skills land in `skills-library/` un-activated:

| Skill | Description |
|-------|-------------|
| `agent-job-secrets` | List and retrieve agent-job secrets (OAuth credentials are auto-refreshed) |
| `agent-job-dm` | List users + send a DM (or broadcast) via the recipient's default channel — defaults `--user-id` to the container's `USER_ID` env so chat-spawned jobs route back to the originator |
| `agent-job-background` | Spawn a new agent job in the background and check its status — defaults `--user-id` to `USER_ID` so the spawned job inherits the originator |
| `playwright-cli` | Browser automation via Playwright CLI |

## Credential setup

If a skill needs an API key, add it at Admin > Event Handler > Agent Jobs. The secret will be injected as an env var into Docker containers. The agent can discover available secrets via the `agent-job-secrets` skill.

---

## Security note

Skills run via bash. The agent has access to environment variables, which means it could `echo $BRAVE_API_KEY` if it wanted to. Protected secrets (AGENT_* prefix) are filtered from the bash environment by the env-sanitizer extension. LLM-accessible secrets (AGENT_LLM_* prefix) are deliberately left available for skills to use.

