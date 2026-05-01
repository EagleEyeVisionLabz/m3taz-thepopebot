# Mobile Testing Plan

Instructions for Claude Code to autonomously test the app's mobile responsiveness using Playwright MCP.

## How This Works

This is a testing *prompt*, not a rigid checklist. You are expected to:

1. **Explore every reachable page** at a mobile viewport — don't just visit the pages listed below, follow links, open menus, and discover what's there
2. **Interact with everything** — tap every button, open every dropdown, trigger every dialog, fill every input you find. Don't wait to be asked — if it's tappable, tap it.
3. **Hunt for problems** — your job is to break things, not confirm they work. Try long text, rapid navigation, edge cases
4. **Screenshot and visually inspect** — accessibility snapshots miss visual issues. Take screenshots and actually look at them. Text wrapping inside buttons, elements touching edges, squished layouts — these only show up visually.
5. **Report what you find** — output a summary of issues with screenshots, not just "all good"
6. **Fix what you can** — if you find issues and have the context to fix them, do it

The sections below describe the app's structure and known areas of concern. Use them as a starting point, not a boundary.

---

## Setup

Set viewport to **360x740** (Galaxy S8 — smallest common phone). If something looks fine at 360, spot-check at 375 (iPhone SE) to make sure nothing breaks at slightly wider sizes.

```
page.setViewportSize({ width: 360, height: 740 })
```

The app uses `md:` (768px) as the mobile/desktop breakpoint. Everything below 768px is "mobile."

Login is required. Navigate to the app URL, authenticate, then begin.

---

## Phase 1: Automated Sweep

Before any manual testing, run a programmatic overflow check on every page. This catches the most common mobile bug (content wider than viewport) instantly.

**Pages to check** (discover more by exploring the sidebar):

```
/, /chats, /runners, /messages, /pull-requests, /containers,
/admin/general, /admin/event-handler/coding-agents,
/admin/event-handler/agent-secrets, /admin/crons, /admin/triggers,
/admin/api-keys, /admin/users, /admin/github
```

The Clusters sidebar entry is currently hidden behind a feature flag, so cluster pages aren't reachable via nav — skip them for sidebar-driven testing.

For each page:
```javascript
document.documentElement.scrollWidth > document.documentElement.clientWidth
```

If overflow is detected, find the culprit:
```javascript
[...document.querySelectorAll('*')].filter(el => {
  const r = el.getBoundingClientRect();
  return r.right > document.documentElement.clientWidth;
}).map(el => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width }))
```

Also navigate into at least one chat with messages (`/chat/{id}`) and one with a long title. These are dynamic pages that the static list above doesn't cover.

---

## Phase 2: Navigation & Sidebar

Test that the user can always get around the app:

- **Every page must have a way to open the sidebar.** Look for a hamburger/toggle button. If a page is missing one, that's a critical bug — the user is trapped.
- **Open the sidebar, navigate to every link**, verify each page loads and the sidebar closes after navigation.
- **Three-dot menus on sidebar chat items** — open them, try every action (Star, Rename, Delete). Verify dialogs appear properly.
- **Sidebar toggle inside the sidebar** — verify it closes the sheet.
- **Filter tabs** (All/Chat/Code) — tap each, verify the list filters.

---

## Phase 3: Page-by-Page Exploration

Visit each page and interact with everything you find. Don't just look — tap it.

### What to do on every page:

1. **Take a screenshot** and visually scan for anything that looks wrong — cut-off text, overlapping elements, tiny buttons, content touching edges with no padding
2. **Tap every interactive element** — every button, link, input, dropdown, toggle, expand/collapse control. If you didn't tap it, you didn't test it.
3. **Open every menu and dialog** — check that they're not clipped, not edge-to-edge with no margin, and dismissible
4. **Check text handling** — long titles, descriptions, URLs, code blocks. Do they truncate, wrap, or overflow?
5. **Verify touch targets** — any button that looks small, check its actual size. Minimum 44x44px per Apple HIG.
6. **Check button labels** — button text must NEVER wrap to multiple lines. If you see a button where the label breaks ("Regene\nrate", "New\nrole"), that's a bug. Buttons use `white-space: nowrap` globally — if one still wraps, something is overriding it or the button is in a container that's too narrow.

### Known pages and what's on them:

| Route | Key elements to test |
|-------|---------------------|
| `/` (new chat) | Chat input, attach button, voice button, code mode toggle, repo/branch selectors in code mode, agent-secrets key icon (agent-mode only), Plan/Code toggle |
| `/chat/{id}` | Message bubbles, message toolbar (copy/retry/edit — tap ALL of them), chat header title dropdown (caret), inline rename, send message, attach files, voice input, auto-run spinner in workspace bar |
| `/chats` | Search, chat list with 3-dot menus, date-grouped sections, rename/delete/star actions from 3-dot menu |
| `/runners` | Runner list, status badges, refresh button, pagination (Previous/Next), "View" links |
| `/pull-requests` | PR list, status indicators, refresh button |
| `/messages` | Inbox / All tabs, click-to-mark-read, mark-all-as-read button, markdown content rendering |
| `/containers` | Live container rows, per-row logs button (FileTextIcon) |
| `/profile/login` | Email/password change form |
| `/profile/telegram` | One-time code generation, verify status |
| `/admin/general` | General settings card |
| `/admin/event-handler/coding-agents` | Default Coding Agent dropdown, per-agent enable/auth/provider/model cards, per-mode Branch/Git action/Auto-run toggles |
| `/admin/event-handler/agent-secrets` | Agent-job secret create/edit/delete |
| `/admin/event-handler/llms` | Provider API key cards + custom OpenAI-compatible providers |
| `/admin/event-handler/helper-llm` | Helper LLM provider/model picker |
| `/admin/event-handler/telegram` | Bot token + Register webhook button |
| `/admin/event-handler/voice` | AssemblyAI key |
| `/admin/event-handler/webhooks` | Webhook secret management |
| `/admin/crons` | Cron cards (read-only listing of `agent-job/CRONS.json`) |
| `/admin/triggers` | Trigger cards (read-only listing of `event-handler/TRIGGERS.json`) |
| `/admin/api-keys` | API key create/copy/regenerate/delete — test the full flow |
| `/admin/users` | User list with role badges |
| `/admin/github` | GitHub variables + tokens |

**But don't stop here.** If you discover pages or UI elements not in this list, test those too.

---

## Phase 4: Dialogs & Modals

Every dialog/modal in the app should:

- Have horizontal margin from screen edges (`mx-4` or similar) — never go edge-to-edge
- Have a way to dismiss (overlay tap, Cancel button, Escape)
- Not clip buttons or text on narrow screens
- Have an overlay/backdrop that dims the background
- Buttons inside dialogs should not wrap text

Known dialogs to find and test:
- **Rename dialog** — triggered from sidebar 3-dot menu, chat title dropdown, and chats page
- **Delete confirmation** — triggered from sidebar 3-dot menu, chat title dropdown, and chats page
- **Link safety modal** — triggered by tapping an external link in a chat message (find a chat with a link or send a message that generates one)
- **Any other dialogs you discover**

---

## Phase 5: Interactive Workflows

Test complete user flows, not just individual elements:

1. **Create a new chat, send a message, get a response** — verify the full flow works on mobile
2. **Rename a chat from the sidebar** — open sidebar, 3-dot menu, rename, save, verify title updates
3. **Rename a chat from the header** — tap the title caret, choose rename, save
4. **Star/unstar a chat** — verify it moves to/from the Starred section
5. **Delete a chat** — verify confirmation appears, confirm, verify it's removed
6. **Search chats** — type in the search box on `/chats`, verify filtering
7. **Create an API key** — go to `/settings/secrets`, create, verify the key displays, copy it, then delete it
8. **Navigate rapidly** — open sidebar, tap a page, immediately open sidebar again, tap another. Does anything break?

---

## Phase 6: Edge Cases to Hunt For

Actively try to break things:

- **Button text wrapping**: Scan every button on every page. Button labels must never break to two lines. Look for squished buttons where the container forces wrapping. Common in flex layouts with `justify-between` where the button shares space with other content.
- **Hover-only UI**: Anything that appears on hover but has no touch equivalent. Common culprit: toolbars, tooltips, menu buttons that only show on `group-hover`. On mobile these are invisible and unreachable.
- **Overflow from dynamic content**: Markdown rendering, long URLs, API keys, cron expressions, error messages — anything that comes from data rather than static labels.
- **Dropdowns near edges**: Dropdown menus near the right or bottom edge of the screen may get clipped. Open every dropdown you find and check.
- **Sticky/fixed elements**: Headers, footers, input bars — do they overlap content? Do they stay in the right place when scrolling?
- **Z-index stacking**: When the sidebar is open and a dialog is triggered, does the dialog appear above the sidebar?
- **Empty states**: Pages with no data (no runners, no PRs, no notifications) — do they still look right?
- **Scrolling behavior**: Long pages (chats list with 60+ items) — does scrolling work smoothly? Does the sticky header stay put?
- **Content cards with multiple elements**: Cards that have icons + text + badges + buttons in a row — do they wrap gracefully or do elements get squished/overlap? Look at runner rows, cron cards, cluster worker cards, API key cards.

---

## Reporting

After testing, output a summary like:

```
## Mobile Test Results — [date]

**Viewport:** 360x740 (Galaxy S8)
**Pages tested:** [list]

### Issues Found

1. **[Page/Component]** — [description]
   - Screenshot: [filename]
   - Severity: critical / moderate / minor
   - Suggested fix: [if you have one]

2. ...

### All Clear
- [list anything that was specifically verified as working]
```

Attach screenshots for every issue. If no issues are found on a page, a single "all clear" line is fine — don't screenshot every passing test.

---

## Known Patterns & Fixes

Common mobile issues and how they've been fixed before. Use this to recognize and fix similar problems:

| Pattern | Symptom | Fix |
|---------|---------|-----|
| Button text wrapping | Button label breaks to multiple lines ("Regene rate") | Global `white-space: nowrap` on buttons in `globals.css`. If still wrapping, the container is too narrow — restructure the layout (e.g., `flex-col` on mobile). |
| Flex child overflow | Long text pushes parent wider than viewport | `min-w-0` on flex children, `truncate` on text |
| Hover-only UI | Buttons/toolbars invisible on touch devices | `opacity-100 md:opacity-0 md:group-hover:opacity-100` |
| Dialog edge-to-edge | Modal content touches screen edges | `mx-4` on dialog content wrapper |
| Dropdown clipping | Menu items cut off at viewport edge | Check `align` prop, ensure `min-w-[150px]` |
| Header overflow | Long title pushes header off-screen | `overflow-hidden` on header, `min-w-0` on title wrapper |
| Badge row overflow | Multiple badges wrap or push container | `flex-wrap` on badge container |
| Safe area gap | iPhone home bar covers input | `pb-[max(1rem,var(--safe-area-bottom))]` |
| Small touch targets | Buttons below 44px tap area | `min-h-[44px] min-w-[44px]` or `p-2 md:p-1` |
| Tooltip popups | Hover tooltips appear on long-press, block the screen | Remove `<Tooltip>` wrapper, use `aria-label` instead |
| Card layout squished | Buttons/badges in cards get compressed on narrow screens | Switch row layout to `flex-col` on mobile, `sm:flex-row` on wider screens |

---

## When to Run This

**Full run:** After layout changes, global CSS changes, new pages, or dependency updates.

**Partial run:** After changes to a specific page — test that page plus Phase 1 overflow sweep.

**Skip the `/code` page** — it's a terminal-based experience designed for desktop. Don't spend time testing it on mobile.
