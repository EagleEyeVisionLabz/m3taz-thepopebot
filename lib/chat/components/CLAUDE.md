# lib/chat/components/

JSX components for the chat UI. Compiled to `.js` by `npm run build` (esbuild).

## Admin Navigation

Top-level admin tabs (`settings-layout.jsx`), in order: **General → Event Handler → Crons → Triggers → Users → GitHub**. Most-used settings up front; GitHub (rarely touched once configured) is last.

Sub-tabs under `/admin/event-handler/` (pill-style nav via `SubTabLayout` in `settings-secrets-layout.jsx`):
- `/admin/event-handler/coding-agents` — Multi-agent config (default coding agent + per-agent enable/auth/provider/model). Section heading: "Coding Agent"; the dropdown row label is "Default Coding Agent".
- `/admin/event-handler/helper-llm` — Helper LLM (provider/model used for chat titles, agent-job titles + summaries)
- `/admin/event-handler/llms` — LLM provider credentials + custom OpenAI-compatible providers
- `/admin/event-handler/agent-secrets` — Custom env vars/secrets injected into agent containers (not `/jobs` — that path is gone)
- `/admin/event-handler/telegram` — Bot token + webhook register
- `/admin/event-handler/voice` — Voice input (AssemblyAI)
- `/admin/event-handler/webhooks` — Webhook secret

The **Clusters** sidebar entry is hidden behind `{false && ...}` for now — markup intact for fast re-enable.

## Key Component Pages

| Component | File | Purpose |
|-----------|------|---------|
| `CodingAgentsPage` | `settings-coding-agents-page.jsx` | Multi-agent config — 6 agent cards (claude-code, pi, codex-cli, gemini-cli, opencode, kimi-cli) with enable/disable, auth mode, model selection. Also holds Default Coding Agent + per-mode Branch/Git action/Auto-run defaults. |
| `JobsPage` / `JobSecretsManager` | `settings-jobs-page.jsx` | Custom env vars for agent job containers. `JobSecretsManager` is also reused as a popup from the agent-mode chat input (KeyIcon left of the Plan/Code dropdown) via `Dialog` with `maxWidth="max-w-2xl"` and `showHeader={false}`. |
| `MessagesPage` | `messages-page.jsx` | Per-user inbox (Inbox/All tabs, click-to-mark-read, bulk mark-all, no delete). Replaces the old global `notifications-page.jsx`. |
| `ContainersPage` | `containers-page.jsx` | Live Docker container monitoring via SSE (`/stream/containers`) plus a per-row logs button (FileTextIcon) that opens `/stream/containers/logs?name=...` |
| `ChatsPage` | `chats-page.jsx` | Full chat history with search, bulk actions |
| `ProfilePage` | `profile-page.jsx` | Two forms: **Profile** (firstName/lastName/nickname, no password gate) and **Login & security** (email/password, current password required) |

## Tool Display Names

`tool-names.js` auto-generates display names from the tool's snake_case name (split on `_`, capitalize each word). No map to maintain — adding a new tool automatically gets a display name.

This file is **UI-only** — it controls display text. There is no host-side tool registry; every tool name in the UI comes from the coding agent's own stream (e.g. `Read`, `Bash`, `Edit`) plus the synthetic `workspace` setup tool emitted by `chatStream()`.

## Error Messages

`chatStream()` emits `{ type: 'error', message }` on failure. `lib/chat/api.js` writes it as an AI SDK `data-error` part; `chat-page.jsx` rehydrates stored errors into the same part shape on refresh; `message.jsx` renders `data-error` parts as a red banner using `text-destructive` / `border-destructive/30 bg-destructive/5`. Errors persist to the `messages` table as JSON (`{"type":"error","message":"..."}`).

## Settings UI Standards

All admin/settings pages follow a unified design system. Shared components live in `settings-shared.jsx`. **Use these components — do not create local duplicates.**

### Shared Components (`settings-shared.jsx`)

| Component | Purpose |
|-----------|---------|
| `StatusBadge` | Green/muted dot + "Set" / "Not set" text |
| `SecretRow` | Unified credential/secret row — handles KeyIcon, status, edit mode, saved feedback, delete |
| `VariableRow` | GitHub variable row — shows current value, text input, delete |
| `Dialog` | Modal wrapper — `max-w-md`, Escape key, backdrop click, portal |
| `EmptyState` | Dashed border card with message and optional action button |
| `formatDate` | Timestamp → "Jan 1, 2025" |
| `timeAgo` | Timestamp → "5m ago" |

### Page Headers

- Section heading: `text-base font-medium` (never `text-lg` or larger — the layout title "Admin" is `text-2xl`)
- With action button: `<div className="flex items-center justify-between mb-4">`
- Without action button: `<div className="mb-4">`
- No horizontal rule dividers between header and content

### Buttons

All buttons include `transition-colors`. Three tiers by context:

| Context | Padding | Text | Example |
|---------|---------|------|---------|
| Inline row | `px-2.5 py-1.5` | `text-xs` | Set, Update, Cancel, Delete |
| Dialog footer | `px-3 py-1.5` | `text-sm` | Save, Cancel |
| Empty state | `px-3 py-1.5` | `text-sm` | Create API key |

Primary: `bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50`
Secondary: `border border-border text-muted-foreground hover:bg-accent hover:text-foreground`
Cancel (inline): `border border-border text-muted-foreground hover:text-foreground`
Cancel (dialog): same as inline cancel
Destructive: `border-destructive text-destructive hover:bg-destructive/10`

### Delete Confirmation

Two-click inline pattern. First click shows "Confirm" in destructive style, auto-resets after 3 seconds. Never use `confirm()` browser dialogs.

### Save Feedback

- During save: button text → "Saving..."
- After save: button border turns green + "Saved" with checkmark for 2 seconds
- Auto-save (Chat LLM only): 800ms debounce, "Saving..." / "Saved" indicators

### Loading Skeletons

`bg-border/50 rounded-md animate-pulse`. Sizes by page type:
- Single-item: `h-24`
- List pages: two blocks `h-16` in `space-y-3`
- Complex pages: `h-48`

### Spacing

- Between major sections: `space-y-6`
- Card padding: `p-4`
- Form field spacing: `space-y-3`
- Dialog footer: `mt-5 flex justify-end gap-2`

### Status Text

Always "Set" / "Not set" — never "Configured".

### Dialogs

- Width: `max-w-md`
- Title: `text-base font-semibold mb-4`
- Use the shared `Dialog` component, not inline modal markup

## Color System

### Semantic Tokens

All colors use CSS custom properties defined in `web/app/globals.css`. Use these Tailwind classes — never raw hex in JSX.

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `background` | `#ffffff` | `#0a0a0a` | Page/component backgrounds |
| `foreground` | `#171717` | `#ededed` | Primary text |
| `primary` | `#171717` | `#ededed` | Primary buttons, focus rings |
| `primary-foreground` | `#ffffff` | `#0a0a0a` | Text on primary buttons |
| `muted` | `#f5f5f5` | `#171717` | Subtle backgrounds (input fields, code blocks) |
| `muted-foreground` | `#737373` | `#a3a3a3` | Secondary text, labels, timestamps |
| `border` | `#e5e5e5` | `#262626` | Borders, dividers, skeleton bases |
| `input` | `#f5f5f5` | `#171717` | Form input backgrounds |
| `destructive` | `#ef4444` | `#ef4444` | Error text, delete buttons |
| `accent` | `#f5f5f5` | `#1a1a1a` | Hover backgrounds for secondary buttons |
| `card` | `#ffffff` | `#0a0a0a` | Card surface backgrounds |

### Status Colors

| State | Text | Dot/Icon | Badge | Banner |
|-------|------|----------|-------|--------|
| Success | `text-green-500` | `bg-green-500` | `bg-green-500/10 text-green-500` | `border-green-500/30 bg-green-500/5` |
| Warning | `text-yellow-500` | `bg-yellow-500` | `bg-yellow-500/10 text-yellow-500` | `border-yellow-500/30 bg-yellow-500/5` |
| Error | `text-destructive` | `bg-destructive` | `bg-destructive/10 text-destructive` | `border-destructive/30 bg-destructive/5` |

### Accepted Exceptions

These patterns use Tailwind color classes directly instead of semantic tokens. They are intentional — do not "fix" them:

- **Tool call icons**: `text-green-500` (done) — small inline status icons in `message.jsx`
- **Terminal view**: hardcoded hex colors for terminal theming in `terminal-view.jsx`
- **Upgrade UI**: `text-emerald-500`, `bg-emerald-500`, `border-emerald-500/*` — the upgrade dialog uses emerald as its brand accent throughout `upgrade-dialog.jsx`

### Overlay Standard

All modal/dialog backdrops use `bg-black/50`. Do not use `/40` or other opacities.

### Forbidden Patterns

- `text-red-400`, `text-red-500`, `bg-red-500` — use `text-destructive` / `bg-destructive` instead
- `text-green-600`, `text-green-400` — use `text-green-500` instead
- `text-yellow-600`, `text-yellow-400` — use `text-yellow-500` instead
- Raw hex values in JSX `style` props (except terminal theming)
- Inventing new color shades not listed above
- Using tokens not defined in `globals.css` (check the table above)
