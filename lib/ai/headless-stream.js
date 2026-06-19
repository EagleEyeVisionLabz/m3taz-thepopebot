import { PassThrough } from 'stream';
import split2 from 'split2';
import { DockerFrameParser } from '../tools/docker.js';

// Re-export from line-mappers for existing consumers
export {
  mapLine,
  mapClaudeCodeLine,
  mapPiLine,
  mapGeminiLine,
  mapCodexLine,
  mapOpenCodeLine,
  mapKimiLine,
} from './line-mappers.js';

import {
  mapLine,
  mapClaudeCodeLine,
  mapPiLine,
  mapGeminiLine,
  mapCodexLine,
  mapOpenCodeLine,
  mapKimiLine,
} from './line-mappers.js';

/**
 * Parse Docker container logs from a headless coding agent container.
 * Supports multiple agent output formats (Claude Code, Pi).
 *
 * Three layers:
 * 1. Docker multiplexed frame decoder (Transform stream)
 * 2. split2 for reliable NDJSON line splitting
 * 3. Agent-specific NDJSON → chat event mapper
 *
 * @param {import('http').IncomingMessage} dockerLogStream - Raw Docker log stream
 * @param {string} [codingAgent='claude-code'] - Which agent format to parse
 * @yields {{ type: string, text?: string, toolCallId?: string, toolName?: string, args?: object, result?: string }}
 */
export async function* parseHeadlessStream(dockerLogStream, codingAgent = 'claude-code') {
  const mapperMap = {
    'claude-code': mapClaudeCodeLine,
    'pi-coding-agent': mapPiLine,
    'gemini-cli': mapGeminiLine,
    'codex-cli': mapCodexLine,
    'opencode': mapOpenCodeLine,
    'kimi-cli': mapKimiLine,
  };
  const mapper = mapperMap[codingAgent] || mapClaudeCodeLine;

  // Layer 1: Docker frame decoder. Stdout frames feed the line splitter;
  // stderr frames are buffered and yielded as `{type:'stderr'}` chunks so the
  // caller can surface them on silent failures (agent crashed before producing
  // JSON).
  const stdoutPipe = new PassThrough();
  // Attach an 'error' handler so that destroying stdoutPipe with an error (on a
  // frame-decode failure or a dockerLogStream error) does not emit an unhandled
  // 'error' event that would hard-crash the shared event-handler process. The
  // error is still propagated to the consumer: destroying the pipe makes the
  // downstream `for await (const line of lines)` loop throw, and that loop's
  // catch re-throws the captured `frameError` so the precise cause surfaces.
  stdoutPipe.on('error', () => {});
  // Bound stderr at the source: retain only a rolling tail so a chatty or
  // crash-looping agent cannot grow this buffer without limit. The tail is
  // capped to STDERR_TAIL_MAX JS string characters (UTF-16 code units), not
  // bytes — for multibyte UTF-8 the retained tail can exceed this many bytes,
  // but it stays bounded. The consumer (lib/ai/index.js) caps the tail too.
  const STDERR_TAIL_MAX = 16384;
  let stderrTail = '';
  const parser = new DockerFrameParser();
  let frameError = null;
  dockerLogStream.on('data', (chunk) => {
    try {
      for (const frame of parser.push(chunk)) {
        if (frame.stream === 'stdout') {
          stdoutPipe.write(Buffer.from(frame.text, 'utf8'));
        } else if (frame.stream === 'stderr' && frame.text) {
          stderrTail = (stderrTail + frame.text).slice(-STDERR_TAIL_MAX);
        }
      }
    } catch (err) {
      frameError = err;
      stdoutPipe.destroy(err);
    }
  });
  dockerLogStream.on('end', () => stdoutPipe.end());
  dockerLogStream.on('error', (err) => stdoutPipe.destroy(err));

  // Layer 2: split2 for reliable line splitting (stdout only)
  const lines = stdoutPipe.pipe(split2());

  // Layer 3: map each complete line to chat events; flush stderr at end.
  // A frame-decode error (or dockerLogStream error) destroys stdoutPipe, which
  // makes this loop throw a stream-destroyed error. Catch it and re-throw the
  // original captured DockerFrameParser error so the precise cause surfaces.
  // The stdoutPipe 'error' handler above prevents the destroy from crashing the
  // process before this catch can run.
  try {
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      for (const event of mapLine(trimmed, mapper)) {
        yield event;
      }
    }
  } catch (err) {
    throw frameError || err;
  }
  if (frameError) throw frameError;
  if (stderrTail) {
    yield { type: 'stderr', text: stderrTail };
  }
}
