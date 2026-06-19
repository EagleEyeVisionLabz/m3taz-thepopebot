/**
 * Base channel adapter interface.
 * Every chat channel (Telegram, Slack, web, etc.) implements this contract.
 */
class ChannelAdapter {
  /**
   * Handle an incoming webhook request from this channel.
   * Returns normalized message data or null if no action needed.
   *
   * @param {Request} request - Incoming HTTP request
   * @returns {Promise<{ channel: string, channelChatId: string, text: string, attachments: Array, metadata: object } | null>}
   *
   * `channelChatId` is the channel-native identifier (e.g. Telegram chat.id). It is
   * NOT the DB chat/thread id — that is resolved downstream via user_channels.
   *
   * Attachments array (may be empty) — only non-text content that the LLM needs to see:
   *   { category: "image", mimeType: "image/png", data: Buffer }  — send to LLM as vision
   *   { category: "document", mimeType: "application/pdf", data: Buffer } — future: extract/attach
   *
   * The adapter downloads authenticated files and normalizes them.
   * Voice/audio messages are fully resolved by the adapter — transcribed to text
   * and included in the `text` field. They are NOT passed as attachments.
   */
  async receive(request) {
    throw new Error('Not implemented');
  }

  /**
   * Called when message is received — adapter shows acknowledgment.
   * Telegram: thumbs up reaction. Slack: emoji reaction. Web: no-op.
   */
  async acknowledge(metadata) {}

  /**
   * Called while AI is processing — adapter shows activity.
   * Telegram: typing indicator. Slack: typing indicator. Web: no-op (streaming handles this).
   * Returns a stop function.
   */
  startProcessingIndicator(metadata) {
    return () => {};
  }

  /**
   * Send a complete (non-streaming) response back to the channel.
   * `channelChatId` is the channel-native chat identifier.
   */
  async sendResponse(channelChatId, text, metadata) {
    throw new Error('Not implemented');
  }

  /**
   * Advisory flag describing whether this channel can stream responses
   * (e.g., web chat via Vercel AI SDK).
   *
   * NOTE: This getter does NOT drive dispatch. The orchestrator selects
   * streaming purely by the presence of a `streamChatResponse(channelChatId, chunks)`
   * method on the adapter (see api/index.js). To enable streaming for a new
   * channel, define `streamChatResponse()` — overriding this getter alone has
   * no effect.
   */
  get supportsStreaming() {
    return false;
  }
}

export { ChannelAdapter };
