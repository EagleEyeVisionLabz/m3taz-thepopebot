# lib/channels/ — Channel Adapters

## ChannelAdapter Base Class (base.js)

Abstract interface for platform integrations. Methods:

| Method | Purpose | Returns |
|--------|---------|---------|
| `receive(request)` | Parse webhook → normalized message | `{ channel, channelChatId, text, attachments, metadata }` or `null` |
| `acknowledge(metadata)` | Show receipt (e.g. emoji reaction) | void |
| `startProcessingIndicator(metadata)` | Show typing/processing | Stop function |
| `sendResponse(channelChatId, text, metadata)` | Send complete response | void |
| `get supportsStreaming` | Can stream responses? | boolean |

## Attachment Handling — Images vs Audio

**Critical distinction**: Audio is preprocessed at the adapter layer. Images are passed through to the LLM.

- **Images** (`message.photo`) → Downloaded, passed as `{ category: 'image', mimeType, data: Buffer }` attachment → LLM receives as vision content
- **Audio** (`message.voice`/`message.audio`) → Transcribed via AssemblyAI → merged into `text` field → **never passed as attachment**
- **Documents** (`message.document`) → Downloaded as `{ category: 'document', mimeType, data: Buffer }`

## Factory (index.js) — Lazy Singleton

`getTelegramAdapter(botToken)` caches a singleton keyed by `botToken`. If the token changes (rotation), a new instance is created.

## Telegram Adapter (telegram.js)

- **Authorization**: per-user via the `user_channels` table. Unverified chats only accept `/verify <code>`; all other messages are dropped. See `lib/db/user-channels.js` and `lib/channels/commands/verify.js`.
- **Webhook auth**: Validates `x-telegram-bot-api-secret-token` header against `TELEGRAM_WEBHOOK_SECRET`.
- **Streaming**: `supportsStreaming` returns `false` — text + tool calls accumulate during streaming and are sent as complete messages once the turn ends. Progressive tool-call rendering inserts intermediate "→ used X" lines as tool calls land.

## Slash Commands (`lib/channels/commands/`)

Post-auth messages starting with `/` are dispatched here before reaching the LLM. Resolution chat.id → userId → activeThreadId happens in `api/index.js` `processChannelMessage`.

| Command | Purpose | Source |
|---------|---------|--------|
| `/verify <code>` | Verify a Telegram account against a one-time code generated in the web UI (`/profile/telegram`). Code expires in 10 minutes. Sets `verifiedAt`. | `commands/verify.js` |
| `/session` | List the user's recent chat threads (active thread marked) | `commands/session.js` |
| `/session list` | Same as `/session` | `commands/session.js` |
| `/session <id>` | Switch the user's `activeThreadId` so subsequent messages route to that chat | `commands/session.js` |
