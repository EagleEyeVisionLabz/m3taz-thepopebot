import { Bot } from 'grammy';
import parseModePlugin from '@grammyjs/parse-mode';
import { randomBytes } from 'crypto';
const { hydrateReply } = parseModePlugin;

const MAX_LENGTH = 4096;

/**
 * Validate a Telegram bot token by calling getMe.
 * @param {string} botToken
 * @returns {Promise<{valid: boolean, botInfo?: object, error?: string}>}
 */
async function validateBotToken(botToken) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const result = await response.json();
    if (result.ok) return { valid: true, botInfo: result.result };
    return { valid: false, error: result.description };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Register a Telegram webhook (deletes any existing webhook first).
 * @param {string} botToken
 * @param {string} webhookUrl
 * @param {string} [secretToken]
 * @returns {Promise<object>} Telegram API response
 */
async function setTelegramWebhook(botToken, webhookUrl, secretToken = null) {
  // Delete first — Telegram ignores secret_token changes if the URL is unchanged
  await deleteTelegramWebhook(botToken);
  const body = { url: webhookUrl };
  if (secretToken) body.secret_token = secretToken;
  const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Telegram setWebhook failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get current webhook info from Telegram.
 * @param {string} botToken
 * @returns {Promise<object>}
 */
async function getTelegramWebhookInfo(botToken) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
  if (!response.ok) {
    throw new Error(`Telegram getWebhookInfo failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Delete the current webhook.
 * @param {string} botToken
 * @returns {Promise<object>}
 */
async function deleteTelegramWebhook(botToken) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Telegram deleteWebhook failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Generate a random webhook secret (64 hex chars).
 */
function generateWebhookSecret() {
  return randomBytes(32).toString('hex');
}

/**
 * Convert markdown to Telegram-compatible HTML.
 * Handles: code blocks, inline code, links, bold, italic, strikethrough, headings, lists.
 * Strips unsupported HTML tags.
 * @param {string} text - Markdown text
 * @returns {string} Telegram HTML
 */
function markdownToTelegramHtml(text) {
  if (!text) return '';

  // Per-call random nonce so the placeholder token cannot collide with content
  // (user/LLM text echoing the sentinel) and desync the restore step.
  const nonce = randomBytes(8).toString('hex');
  const placeholders = [];
  function placeholder(content) {
    const id = `\x00PH${nonce}_${placeholders.length}\x00`;
    placeholders.push(content);
    return id;
  }

  // Strip any pre-existing control-char sentinels from input so they can't be
  // mistaken for our placeholders during restore.
  text = text.replace(/\x00/g, '');

  // 1. Protect existing supported HTML tags (so they survive escaping)
  text = text.replace(/<(\/?(b|i|s|u|code|pre|a)\b[^>]*)>/g, (match) => {
    return placeholder(match);
  });

  // 2. Extract fenced code blocks (``` ... ```)
  text = text.replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => {
    return placeholder(`<pre>${escapeHtml(code.replace(/\n$/, ''))}</pre>`);
  });

  // 3. Extract inline code (` ... `)
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    return placeholder(`<code>${escapeHtml(code)}</code>`);
  });

  // 4. Escape remaining HTML special chars (after code + existing tags are protected)
  text = escapeHtml(text);

  // 5. Links: [text](url) — escape the quote that escapeHtml (step 4) leaves and
  // allow only safe schemes, so a crafted URL can't break out of the attribute
  // or smuggle a bad scheme. (`&`/`<`/`>` are already escaped at this point.)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
    const trimmed = url.trim();
    if (!/^(https?|tg):/i.test(trimmed)) return label;
    return `<a href="${trimmed.replace(/"/g, '&quot;')}">${label}</a>`;
  });

  // 6. Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__(.+?)__/g, '<b>$1</b>');

  // 7. Italic: *text* or _text_ (but not inside words for underscores)
  text = text.replace(/(?<!\w)\*([^*\n<]+)\*(?!\w)/g, '<i>$1</i>');
  text = text.replace(/(?<!\w)_([^_\n<]+)_(?!\w)/g, '<i>$1</i>');

  // 8. Strikethrough: ~~text~~
  text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // 9. Headings: ## text → bold (must be at line start)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // 10. List items: - item or * item → bullet
  text = text.replace(/^[\s]*[-*]\s+/gm, '• ');

  // 11. Numbered list items: 1. item → keep as-is (already plain text friendly)

  // 12. Restore placeholders (reverse order so a restored tag containing a
  // lower-index token can't be re-substituted)
  for (let i = placeholders.length - 1; i >= 0; i--) {
    text = text.replaceAll(`\x00PH${nonce}_${i}\x00`, placeholders[i]);
  }

  return text;
}

let bot = null;
let currentToken = null;

/**
 * Get or create bot instance
 * @param {string} token - Bot token from @BotFather
 * @returns {Bot} grammY Bot instance
 */
function getBot(token) {
  if (!bot || currentToken !== token) {
    bot = new Bot(token);
    bot.use(hydrateReply);
    currentToken = token;
  }
  return bot;
}

/**
 * Smart split text into chunks that fit Telegram's limit
 * Prefers splitting at paragraph > newline > sentence > space
 * @param {string} text - Text to split
 * @param {number} maxLength - Maximum chunk length
 * @returns {string[]} Array of chunks
 */
function smartSplit(text, maxLength = MAX_LENGTH) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    const chunk = remaining.slice(0, maxLength);
    let splitAt = -1;

    // Try to split at natural boundaries (prefer earlier ones)
    for (const delim of ['\n\n', '\n', '. ', ' ']) {
      const idx = chunk.lastIndexOf(delim);
      if (idx > maxLength * 0.3) {
        splitAt = idx + delim.length;
        break;
      }
    }

    if (splitAt === -1) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Send a message to a Telegram chat with HTML formatting
 * Automatically splits long messages
 * @param {string} botToken - Bot token from @BotFather
 * @param {number|string} chatId - Chat ID to send message to
 * @param {string} text - Message text (HTML formatted)
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.disablePreview] - Disable link previews
 * @returns {Promise<Object>} - Last message sent
 */
async function sendMessage(botToken, chatId, text, options = {}) {
  const b = getBot(botToken);
  text = markdownToTelegramHtml(text);
  // Strip HTML comments — Telegram's HTML parser doesn't support them
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  const chunks = smartSplit(text, MAX_LENGTH);

  let lastMessage;
  for (const chunk of chunks) {
    try {
      lastMessage = await b.api.sendMessage(chatId, chunk, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: options.disablePreview ?? false },
      });
    } catch (err) {
      // A blind split can land inside an HTML tag, producing malformed entities
      // that Telegram's HTML parser rejects with HTTP 400. Retry as plain text
      // so the message still lands instead of aborting the whole turn.
      if (err?.error_code === 400) {
        lastMessage = await b.api.sendMessage(chatId, chunk, {
          link_preview_options: { is_disabled: options.disablePreview ?? false },
        });
      } else {
        throw err;
      }
    }
  }

  return lastMessage;
}

/**
 * Download a file from Telegram servers
 * @param {string} botToken - Bot token from @BotFather
 * @param {string} fileId - Telegram file_id
 * @returns {Promise<{buffer: Buffer, filename: string}>}
 */
async function downloadFile(botToken, fileId) {
  // Get file path from Telegram
  const fileInfoRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
  );
  if (!fileInfoRes.ok) {
    throw new Error(`Telegram getFile failed: ${fileInfoRes.status} ${fileInfoRes.statusText}`);
  }
  const fileInfo = await fileInfoRes.json();
  if (!fileInfo.ok) {
    throw new Error(`Telegram API error: ${fileInfo.description}`);
  }

  const filePath = fileInfo.result.file_path;

  // Download file
  const fileRes = await fetch(
    `https://api.telegram.org/file/bot${botToken}/${filePath}`
  );
  if (!fileRes.ok) {
    throw new Error(`Telegram file download failed: ${fileRes.status} ${fileRes.statusText}`);
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error('Telegram file download returned an empty buffer');
  }
  const filename = filePath.split('/').pop();

  return { buffer, filename };
}

/**
 * React to a message with an emoji
 * @param {string} botToken - Bot token from @BotFather
 * @param {number|string} chatId - Chat ID
 * @param {number} messageId - Message ID to react to
 * @param {string} [emoji='\ud83d\udc4d'] - Emoji to react with
 */
async function reactToMessage(botToken, chatId, messageId, emoji = '\ud83d\udc4d') {
  const b = getBot(botToken);
  await b.api.setMessageReaction(chatId, messageId, [{ type: 'emoji', emoji }]);
}

/**
 * Start a repeating typing indicator for a chat.
 * Returns a stop function. The indicator naturally expires after 5s,
 * so we re-send with random gaps (5.5-8s) to look human.
 * @param {string} botToken - Bot token from @BotFather
 * @param {number|string} chatId - Chat ID
 * @returns {Function} Call to stop the typing indicator
 */
function startTypingIndicator(botToken, chatId) {
  const b = getBot(botToken);
  let timeout;
  let stopped = false;

  function scheduleNext() {
    if (stopped) return;
    const delay = 5500 + Math.random() * 2500;
    timeout = setTimeout(() => {
      if (stopped) return;
      b.api.sendChatAction(chatId, 'typing').catch(() => {});
      scheduleNext();
    }, delay);
  }

  b.api.sendChatAction(chatId, 'typing').catch(() => {});
  scheduleNext();

  return () => {
    stopped = true;
    clearTimeout(timeout);
  };
}

/**
 * Format a tool call as a compact one-liner for Telegram.
 * @param {string} toolName - e.g. 'Read', 'Edit', 'Bash', 'Grep'
 * @param {object} args - Tool arguments
 * @returns {string} Formatted HTML string
 */
function formatToolCall(toolName, args) {
  let detail = '';

  if (args.file_path) {
    // Read, Edit, Write — show the file path (basename + parent)
    const parts = args.file_path.split('/');
    detail = parts.length > 2 ? parts.slice(-2).join('/') : parts.pop();
  } else if (args.command) {
    // Bash — show the command, truncated
    detail = args.command.length > 60 ? args.command.slice(0, 57) + '...' : args.command;
  } else if (args.pattern) {
    // Grep, Glob — show the pattern
    detail = args.pattern;
    if (args.path) {
      const parts = args.path.split('/');
      detail += ` in ${parts.length > 2 ? parts.slice(-2).join('/') : parts.pop()}`;
    }
  } else if (args.prompt) {
    // Agent — show truncated prompt
    detail = args.prompt.length > 50 ? args.prompt.slice(0, 47) + '...' : args.prompt;
  } else if (args.description) {
    detail = args.description;
  }

  const escaped = escapeHtml(detail);
  return `⚙️ <code>${escapeHtml(toolName)}</code>  ${escaped}`;
}

export {
  getBot,
  sendMessage,
  smartSplit,
  escapeHtml,
  markdownToTelegramHtml,
  formatToolCall,
  downloadFile,
  reactToMessage,
  startTypingIndicator,
  validateBotToken,
  setTelegramWebhook,
  getTelegramWebhookInfo,
  deleteTelegramWebhook,
  generateWebhookSecret,
};
