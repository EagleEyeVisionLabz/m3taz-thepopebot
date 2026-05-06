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
  const stderrChunks = [];
  const parser = new DockerFrameParser();
  let frameError = null;
  dockerLogStream.on('data', (chunk) => {
    try {
      for (const frame of parser.push(chunk)) {
        if (frame.stream === 'stdout') {
          stdoutPipe.write(Buffer.from(frame.text, 'utf8'));
        } else if (frame.stream === 'stderr' && frame.text) {
          stderrChunks.push(frame.text);
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

  // Layer 3: map each complete line to chat events; flush stderr at end
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const event of mapLine(trimmed, mapper)) {
      yield event;
    }
  }
  if (frameError) throw frameError;
  if (stderrChunks.length) {
    yield { type: 'stderr', text: stderrChunks.join('') };
  }
}
