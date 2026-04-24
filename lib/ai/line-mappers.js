/**
 * Agent NDJSON line mappers — pure JavaScript, no Node.js dependencies.
 * Shared between server-side streaming (headless-stream.js, cluster/stream.js)
 * and client-side historical log rendering (cluster-logs-page.jsx).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Core mapper infrastructure
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a mapped event has empty essential fields (wrong field names, broken extraction).
 */
function isEmptyEvent(e) {
  if (e.type === 'text' && !e.text) return true;
  if (e.type === 'tool-call' && !e.toolName) return true;
  if (e.type === 'tool-result' && !e.toolCallId) return true;
  return false;
}

/**
 * Map a single NDJSON line to chat events.
 * @param {string} line - Raw NDJSON line
 * @param {Function} [mapper=mapClaudeCodeLine] - Agent-specific mapper
 * @returns {Array<object>} Zero or more chat events
 */
export function mapLine(line, mapper = mapClaudeCodeLine) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    // Suppress entrypoint.sh step markers ("→ Setup Git", "→ Clone", ...)
    if (line.startsWith('→ ')) return [{ type: 'skip' }];
    console.warn('[line-mappers] JSON parse failed, length:', line.length, 'preview:', line.slice(0, 120));
    // Non-JSON lines (NO_CHANGES, PUSH_SUCCESS, AGENT_FAILED, etc.)
    return [{ type: 'text', text: `\n${line}\n` }];
  }

  const events = mapper(parsed);
  // If mapper explicitly skipped this event, suppress it (not unknown)
  if (events.some(e => e.type === 'skip')) {
    return [];
  }
  // If mapper returned nothing, or every event has empty essential fields, emit as unknown
  if (events.length === 0 || events.every(isEmptyEvent)) {
    return [{ type: 'unknown', raw: parsed }];
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Code: --output-format stream-json
// Types: assistant, user, result
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a Claude Code stream-json line to chat events.
 * @param {object} parsed - Parsed JSON object
 * @returns {Array<object>}
 */
export function mapClaudeCodeLine(parsed) {
  const events = [];
  const { type, subtype, message, result, tool_use_result } = parsed;

  // System events — all handled by the container, skip silently
  if (type === 'system') {
    return [{ type: 'skip' }];
  }

  // Rate limit events — skip if allowed, surface as text if blocked
  if (type === 'rate_limit_event') {
    if (parsed.rate_limit_info?.status === 'allowed') {
      return [{ type: 'skip' }];
    }
    return [{ type: 'text', text: `Rate limited (${parsed.rate_limit_info?.rateLimitType}) — resets at ${new Date((parsed.rate_limit_info?.resetsAt || 0) * 1000).toLocaleString()}` }];
  }

  if (type === 'assistant' && message?.content) {
    for (const block of message.content) {
      if (block.type === 'text' && block.text) {
        events.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        events.push({
          type: 'tool-call',
          toolCallId: block.id,
          toolName: block.name,
          args: block.input,
        });
      }
      // thinking blocks — skip silently
    }
    // If assistant message had only thinking blocks (no text or tool_use), skip
    if (events.length === 0) return [{ type: 'skip' }];
  } else if (type === 'user' && message?.content) {
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        const resultText = tool_use_result?.stdout ?? (
          typeof block.content === 'string' ? block.content :
          Array.isArray(block.content) ? block.content.map(b => b.text || '').join('') :
          JSON.stringify(block.content)
        );
        events.push({
          type: 'tool-result',
          toolCallId: block.tool_use_id,
          result: resultText,
        });
      }
    }
    // User messages without tool_result (e.g. subagent prompts) — skip
    if (events.length === 0) return [{ type: 'skip' }];
  } else if (type === 'result' && result) {
    events.push({ type: 'text', text: result });
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pi Coding Agent: --mode json
//
// Top-level event types:
//   session, agent_start, agent_end           — session/lifecycle (skip)
//   turn_start, turn_end                      — turn lifecycle (skip)
//   message_start, message_update, message_end — message lifecycle
//   tool_execution_start/update/end           — tool execution
//
// message_update.assistantMessageEvent subtypes:
//   text_start, text_delta, text_end          — only text_delta carries new content
//   thinking_start, thinking_delta, thinking_end — extended-thinking blocks
//   toolcall_start, toolcall_delta, toolcall_end — only toolcall_end carries complete args
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a Pi --mode json line to chat events.
 * @param {object} parsed - Parsed JSON object
 * @returns {Array<object>}
 */
export function mapPiLine(parsed) {
  const events = [];
  const { type } = parsed;

  // Lifecycle / session noise — skip silently so they don't render as Unknown Events
  if (
    type === 'session' ||
    type === 'agent_start' ||
    type === 'agent_end' ||
    type === 'turn_start' ||
    type === 'turn_end' ||
    type === 'message_start' ||
    type === 'message_end' ||
    type === 'tool_execution_start' ||
    type === 'tool_execution_update'
  ) {
    return [{ type: 'skip' }];
  }

  if (type === 'message_update' && parsed.assistantMessageEvent) {
    const evt = parsed.assistantMessageEvent;

    // Text streaming — deltas are authoritative; start/end are lifecycle only
    if (evt.type === 'text_delta' && evt.delta) {
      events.push({ type: 'text', text: evt.delta });
    } else if (evt.type === 'text_start' || evt.type === 'text_end') {
      return [{ type: 'skip' }];
    }

    // Extended-thinking streaming — map to UI thinking chunks (rendered as a
    // collapsible ephemeral card by api.js, never persisted)
    else if (evt.type === 'thinking_start') {
      events.push({ type: 'thinking-start' });
    } else if (evt.type === 'thinking_delta' && evt.delta) {
      events.push({ type: 'thinking', delta: evt.delta });
    } else if (evt.type === 'thinking_end') {
      events.push({ type: 'thinking-end' });
    }

    // Tool call — emit once on toolcall_end with complete args. Start/delta are skipped.
    else if (evt.type === 'toolcall_end' && evt.toolCall) {
      events.push({
        type: 'tool-call',
        toolCallId: evt.toolCall.id,
        toolName: evt.toolCall.name,
        args: evt.toolCall.arguments || {},
      });
    } else if (evt.type === 'toolcall_start' || evt.type === 'toolcall_delta') {
      return [{ type: 'skip' }];
    }
  }

  // Tool execution result
  else if (type === 'tool_execution_end') {
    const resultText = parsed.result?.content
      ?.map(b => b.text || '')
      .join('') || '';
    events.push({
      type: 'tool-result',
      toolCallId: parsed.toolCallId || '',
      result: resultText,
    });
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini CLI: --output-format stream-json
//
// Event types (from real output):
//   init           — session start (session_id, model). Skip.
//   message        — role: "user" (prompt echo, skip) or "assistant" (text output).
//                    Assistant messages have content (string) and delta: true for streaming.
//   tool_use       — tool_name, tool_id, parameters
//   tool_result    — tool_id, status, output
//   result         — status, stats (token counts, duration). Final event.
//   error          — error message
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a Gemini CLI stream-json line to chat events.
 * @param {object} parsed - Parsed JSON object
 * @returns {Array<object>}
 */
export function mapGeminiLine(parsed) {
  const events = [];
  const { type } = parsed;

  if (type === 'message') {
    // Skip user prompt echo
    if (parsed.role === 'user') return [{ type: 'skip' }];
    // Assistant text (streamed as delta chunks)
    const content = typeof parsed.content === 'string' ? parsed.content : parsed.content?.text;
    if (content) events.push({ type: 'text', text: content });
  } else if (type === 'tool_use') {
    events.push({
      type: 'tool-call',
      toolCallId: parsed.tool_id || parsed.id || '',
      toolName: parsed.tool_name || parsed.name || '',
      args: parsed.parameters || parsed.input || {},
    });
  } else if (type === 'tool_result') {
    const output = parsed.output !== undefined
      ? (typeof parsed.output === 'string' ? parsed.output : JSON.stringify(parsed.output))
      : '';
    events.push({
      type: 'tool-result',
      toolCallId: parsed.tool_id || parsed.id || '',
      result: output,
    });
  } else if (type === 'result') {
    // Final stats event — emit token summary as result
    const stats = parsed.stats;
    if (stats) {
      const summary = `Completed (${stats.total_tokens || 0} tokens, ${stats.tool_calls || 0} tool calls, ${((stats.duration_ms || 0) / 1000).toFixed(1)}s)`;
      events.push({ type: 'text', text: summary });
    }
    return events.length ? events : [{ type: 'skip' }];
  } else if (type === 'error') {
    events.push({ type: 'text', text: `Error: ${parsed.message || parsed.error || JSON.stringify(parsed)}` });
  } else if (type === 'init') {
    return [{ type: 'skip' }];
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Kimi CLI: OpenAI-style function calling JSON
//
// Event shapes (from real output):
//   role: "assistant", content: [], tool_calls: [{ type: "function", id, function: { name, arguments } }]
//   role: "assistant", content: "text..." (with or without tool_calls)
//   role: "tool", content: "...", tool_call_id: "..."
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a Kimi CLI line to chat events.
 * @param {object} parsed - Parsed JSON object
 * @returns {Array<object>}
 */
export function mapKimiLine(parsed) {
  const events = [];
  const { role, content, tool_calls, tool_call_id } = parsed;

  if (role === 'assistant') {
    // Text content — can be a string or an array of blocks
    if (typeof content === 'string' && content) {
      events.push({ type: 'text', text: content });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'string' && block) {
          events.push({ type: 'text', text: block });
        } else if (block?.type === 'text' && block.text) {
          events.push({ type: 'text', text: block.text });
        }
      }
    }

    // Tool calls — OpenAI function calling format
    if (Array.isArray(tool_calls)) {
      for (const tc of tool_calls) {
        if (tc.type === 'function' && tc.function) {
          let args = {};
          try {
            args = typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments || {};
          } catch { /* leave as empty object */ }
          events.push({
            type: 'tool-call',
            toolCallId: tc.id || '',
            toolName: tc.function.name || '',
            args,
          });
        }
      }
    }

    // Assistant message with only empty content and no tool calls — skip
    if (events.length === 0) return [{ type: 'skip' }];
  } else if (role === 'tool') {
    const resultText = typeof content === 'string' ? content :
      Array.isArray(content) ? content.map(b => (typeof b === 'string' ? b : b?.text || '')).join('') :
      JSON.stringify(content);
    events.push({
      type: 'tool-result',
      toolCallId: tool_call_id || '',
      result: resultText,
    });
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Codex CLI: --json
//
// Event types (from real output):
//   thread.started    — session start (thread_id). Skip.
//   turn.started      — turn begins. Skip.
//   item.started      — tool call in progress (command_execution, mcp_tool_call). Skip.
//   item.completed    — completed item (agent_message, command_execution, mcp_tool_call, file_change)
//   turn.completed    — turn ends with usage stats
//   turn.failed       — turn failed with error
//   error             — error message
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a Codex CLI --json line to chat events.
 * @param {object} parsed - Parsed JSON object
 * @returns {Array<object>}
 */
export function mapCodexLine(parsed) {
  const events = [];
  const { type, item } = parsed;

  if (type === 'item.completed' && item) {
    if (item.type === 'agent_message' && item.text) {
      events.push({ type: 'text', text: item.text });
    } else if (item.type === 'command_execution') {
      events.push({
        type: 'tool-call',
        toolCallId: item.id || '',
        toolName: 'command',
        args: { command: item.command || item.input || '' },
      });
      if (item.aggregated_output !== undefined) {
        events.push({
          type: 'tool-result',
          toolCallId: item.id || '',
          result: typeof item.aggregated_output === 'string' ? item.aggregated_output : JSON.stringify(item.aggregated_output),
        });
      }
    } else if (item.type === 'mcp_tool_call') {
      events.push({
        type: 'tool-call',
        toolCallId: item.id || '',
        toolName: `${item.server || 'mcp'}:${item.tool || 'unknown'}`,
        args: item.arguments || {},
      });
      if (item.result) {
        const resultText = item.result.content
          ?.map(b => b.text || '').join('') || JSON.stringify(item.result);
        events.push({
          type: 'tool-result',
          toolCallId: item.id || '',
          result: resultText,
        });
      }
    } else if (item.type === 'file_change') {
      events.push({
        type: 'tool-call',
        toolCallId: item.id || '',
        toolName: 'file_change',
        args: { file: item.file || item.path || '', action: item.action || 'edit' },
      });
    }
  } else if (type === 'turn.completed') {
    const usage = parsed.usage;
    if (usage) {
      const summary = `Completed (${usage.input_tokens || 0} input, ${usage.output_tokens || 0} output tokens)`;
      events.push({ type: 'text', text: summary });
    }
    return events.length ? events : [{ type: 'skip' }];
  } else if (type === 'turn.failed') {
    const msg = parsed.error?.message || JSON.stringify(parsed.error || parsed);
    events.push({ type: 'text', text: `Error: ${msg}` });
  } else if (type === 'error') {
    events.push({ type: 'text', text: `Error: ${parsed.message || parsed.error || JSON.stringify(parsed)}` });
  } else if (type === 'thread.started' || type === 'turn.started' || type === 'item.started') {
    return [{ type: 'skip' }];
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenCode: --format json
//
// Event types (from real output):
//   step_start  — new step begins (has part.snapshot)
//   step_finish — step ends (has part.cost, part.tokens, part.reason)
//   text        — assistant text output (part.text)
//   tool_use    — tool call with completed state (part.tool, part.callID,
//                 part.state.input, part.state.output)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map an OpenCode --format json line to chat events.
 * @param {object} parsed - Parsed JSON object
 * @returns {Array<object>}
 */
export function mapOpenCodeLine(parsed) {
  const events = [];
  const { type, part } = parsed;

  // Text output — part.text contains the assistant's response
  if (type === 'text' && part?.text) {
    events.push({ type: 'text', text: part.text });
  }

  // Tool use — OpenCode emits a single event with completed state (input + output)
  else if (type === 'tool_use' && part) {
    const callId = part.callID || part.id || '';
    const toolName = part.tool || '';
    const state = part.state || {};

    events.push({
      type: 'tool-call',
      toolCallId: callId,
      toolName,
      args: state.input || {},
    });

    if (state.status === 'completed' && state.output !== undefined) {
      events.push({
        type: 'tool-result',
        toolCallId: callId,
        result: typeof state.output === 'string' ? state.output : JSON.stringify(state.output),
      });
    }
  }

  // Known noise — skip silently (don't trigger unknown fallback)
  else if (type === 'step_start' || type === 'step_finish') {
    return [{ type: 'skip' }];
  }

  // Error
  else if (type === 'error') {
    events.push({ type: 'text', text: `Error: ${parsed.message || parsed.error || JSON.stringify(parsed)}` });
  }

  return events;
}
