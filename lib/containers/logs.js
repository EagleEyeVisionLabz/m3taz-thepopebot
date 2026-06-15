import { auth } from '../auth/index.js';
import {
  inspectContainer,
  tailContainerLogs,
  getContainerLogs,
  waitForContainer,
  removeContainer,
  DockerFrameParser,
} from '../tools/docker.js';
import { mapLine } from '../ai/line-mappers.js';

/**
 * SSE endpoint for streaming a single container's logs.
 *
 * Query params:
 *   name       — container name (required)
 *   cleanup    — if 'true', remove container when stream ends (for ephemeral command containers)
 *
 * Events:
 *   log   — { stream: 'stdout'|'stderr', raw: string, parsed?: Array }
 *   exit  — { exitCode: number }
 *   error — { message: string }
 *   ping  — {} (keepalive every 15s)
 */
export async function GET(request) {
  const session = await auth();
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  const cleanup = url.searchParams.get('cleanup') === 'true';

  if (!name) {
    return new Response('Missing name parameter', { status: 400 });
  }

  // Authorization: admins may access any container; everyone else is limited to
  // ephemeral command containers (unguessable `command-...-<rand>` names). This
  // stops non-admins from reading logs of, or force-removing (cleanup=true),
  // infra / workspace / cluster containers by name.
  if (session.user.role !== 'admin' && !/^command-[\w.-]+$/.test(name)) {
    return new Response('Forbidden', { status: 403 });
  }

  // Check container exists and get its state
  const info = await inspectContainer(name);
  if (!info) {
    return new Response('Container not found', { status: 404 });
  }

  const isRunning = info.State?.Running === true;
  const controller = new AbortController();
  const { signal } = controller;

  const stream = new ReadableStream({
    async start(streamController) {
      const encoder = new TextEncoder();

      function send(event, data) {
        try {
          streamController.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      }

      // Shared line-buffered log sender
      function sendLines(buf, streamType) {
        const lines = buf.split('\n');
        const remainder = lines.pop(); // incomplete trailing line
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (streamType === 'stdout') {
            send('log', { stream: 'stdout', raw: trimmed, parsed: mapLine(trimmed) });
          } else {
            send('log', { stream: 'stderr', raw: trimmed });
          }
        }
        return remainder;
      }

      if (isRunning) {
        // ── Live streaming for running containers ──
        let logStream = null;
        const keepalive = setInterval(() => send('ping', {}), 15000);

        try {
          logStream = await tailContainerLogs(name);
          if (signal.aborted) {
            logStream.destroy();
            return;
          }

          const parser = new DockerFrameParser();
          let stdoutBuf = '';
          let stderrBuf = '';

          logStream.on('data', (chunk) => {
            for (const frame of parser.push(chunk)) {
              if (frame.stream === 'stdout') {
                stdoutBuf = sendLines(stdoutBuf + frame.text, 'stdout');
              } else if (frame.stream === 'stderr') {
                stderrBuf = sendLines(stderrBuf + frame.text, 'stderr');
              }
            }
          });

          logStream.on('end', async () => {
            // Container exited — get exit code
            try {
              const exitCode = await waitForContainer(name);
              send('exit', { exitCode });
              if (cleanup) {
                try { await removeContainer(name); } catch {}
              }
            } catch {
              send('exit', { exitCode: -1 });
            }
            clearInterval(keepalive);
            try { streamController.close(); } catch {}
          });

          logStream.on('error', () => {
            send('error', { message: 'Log stream error' });
            clearInterval(keepalive);
            if (cleanup) {
              removeContainer(name).catch(() => {});
            }
            try { streamController.close(); } catch {}
          });

          // Cleanup on client disconnect
          signal.addEventListener('abort', () => {
            clearInterval(keepalive);
            if (logStream) {
              try { logStream.destroy(); } catch {}
            }
            if (cleanup) {
              removeContainer(name).catch(() => {});
            }
            try { streamController.close(); } catch {}
          });

        } catch (err) {
          clearInterval(keepalive);
          send('error', { message: err.message || 'Failed to tail logs' });
          if (cleanup) {
            removeContainer(name).catch(() => {});
          }
          try { streamController.close(); } catch {}
        }

      } else {
        // ── Batch dump for stopped/exited containers ──
        try {
          const rawLogs = await getContainerLogs(name);
          const lines = rawLogs.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            // getContainerLogs already parses frames and returns text,
            // so these are raw NDJSON lines — parse with mapLine
            send('log', { stream: 'stdout', raw: trimmed, parsed: mapLine(trimmed) });
          }

          // Exit code from inspect data
          const exitCode = info.State?.ExitCode ?? -1;
          send('exit', { exitCode });
          if (cleanup) {
            try { await removeContainer(name); } catch {}
          }
        } catch (err) {
          send('error', { message: err.message || 'Failed to get logs' });
          if (cleanup) {
            try { await removeContainer(name); } catch {}
          }
        }

        try { streamController.close(); } catch {}
      }
    },
    cancel() {
      controller.abort();
    },
  });

  // Abort when client disconnects
  request.signal?.addEventListener('abort', () => controller.abort());

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
