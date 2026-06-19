import { auth } from '../auth/index.js';
import { getClusterById, getClusterRolesByCluster, roleShortId } from '../db/clusters.js';
import { clusterNaming } from './execute.js';
import { listContainers, tailContainerLogs, getContainerStats, DockerFrameParser } from '../tools/docker.js';
import { mapLine } from '../ai/line-mappers.js';

export async function GET(request, { params } = {}) {
  const session = await auth();
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { clusterId } = (await params) ?? {};

  if (!clusterId) {
    return new Response('Missing clusterId', { status: 400 });
  }

  const cluster = getClusterById(clusterId);
  if (!cluster || cluster.userId !== session.user.id) {
    return new Response('Not found', { status: 404 });
  }

  const { project } = clusterNaming(cluster);
  const clusterPrefix = `${project}-`;
  const controller = new AbortController();
  const { signal } = controller;

  const stream = new ReadableStream({
    async start(streamController) {
      const encoder = new TextEncoder();
      const activeTails = new Map(); // containerName -> { stream, cleanup }

      function send(event, data) {
        try {
          streamController.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      }

      // Build role lookup for display names
      function getRoleLookup() {
        const roles = getClusterRolesByCluster(clusterId);
        const lookup = {};
        for (const r of roles) {
          lookup[roleShortId(r)] = { id: r.id, roleName: r.roleName, maxConcurrency: r.maxConcurrency };
        }
        return lookup;
      }

      // Tail logs for a single container
      function startTailing(containerName) {
        if (activeTails.has(containerName)) return;

        const entry = { stream: null, alive: true };
        activeTails.set(containerName, entry);

        (async () => {
          try {
            const logStream = await tailContainerLogs(containerName);
            if (!entry.alive || signal.aborted) {
              logStream.destroy();
              return;
            }
            entry.stream = logStream;

            const frameParser = new DockerFrameParser();
            let stdoutBuf = '';
            let stderrBuf = '';

            logStream.on('data', (chunk) => {
              for (const frame of frameParser.push(chunk)) {
                if (frame.stream === 'stdout') {
                  stdoutBuf += frame.text;
                  const lines = stdoutBuf.split('\n');
                  stdoutBuf = lines.pop();
                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    send('log', { containerName, stream: 'stdout', raw: trimmed, parsed: mapLine(trimmed) });
                  }
                } else if (frame.stream === 'stderr') {
                  stderrBuf += frame.text;
                  const lines = stderrBuf.split('\n');
                  stderrBuf = lines.pop();
                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    send('log', { containerName, stream: 'stderr', raw: trimmed });
                  }
                }
              }
            });

            logStream.on('end', () => {
              stopTailing(containerName);
            });

            logStream.on('error', () => {
              stopTailing(containerName);
            });
          } catch {
            stopTailing(containerName);
          }
        })();
      }

      function stopTailing(name) {
        const entry = activeTails.get(name);
        if (!entry) return;
        entry.alive = false;
        if (entry.stream) {
          try { entry.stream.destroy(); } catch {}
        }
        activeTails.delete(name);
      }

      // Status + stats polling — dynamic container discovery
      async function pollStatus() {
        if (signal.aborted) return;
        try {
          const containers = await listContainers(clusterPrefix);
          const roleLookup = getRoleLookup();

          // Group containers by role
          const roles = {};
          const activeNames = new Set();

          // Fetch stats for running containers in parallel to avoid serializing
          // the slow Docker stats calls inside the per-container loop.
          const statsByName = new Map();
          await Promise.all(
            containers.map(async (c) => {
              if (c.state === 'running') {
                try {
                  statsByName.set(c.name, await getContainerStats(c.name));
                } catch {
                  statsByName.set(c.name, null);
                }
              }
            })
          );

          for (const c of containers) {
            activeNames.add(c.name);
            // Parse container name: cluster-{cid}-role-{rid}-{workerUuid}
            const parts = c.name.split('-');
            // Find 'role' segment
            const roleIdx = parts.indexOf('role');
            if (roleIdx < 0 || roleIdx + 1 >= parts.length) continue;
            const rShortId = parts[roleIdx + 1];
            const workerUuid = parts.slice(roleIdx + 2).join('-');
            const roleInfo = roleLookup[rShortId];

            if (!roleInfo) continue;
            if (!roles[roleInfo.id]) {
              roles[roleInfo.id] = {
                roleName: roleInfo.roleName,
                maxConcurrency: roleInfo.maxConcurrency,
                containers: [],
              };
            }

            const isRunning = c.state === 'running';
            let stats = null;
            if (isRunning) {
              stats = statsByName.get(c.name) ?? null;
              startTailing(c.name);
            } else {
              stopTailing(c.name);
            }

            roles[roleInfo.id].containers.push({
              name: c.name,
              id: c.id,
              workerUuid,
              running: isRunning,
              cpu: stats?.cpu ?? 0,
              memUsage: stats?.memUsage ?? 0,
              memLimit: stats?.memLimit ?? 0,
              netRx: stats?.netRx ?? 0,
              netTx: stats?.netTx ?? 0,
            });
          }

          // Also include roles with no running containers
          for (const [rShortId, roleInfo] of Object.entries(roleLookup)) {
            if (!roles[roleInfo.id]) {
              roles[roleInfo.id] = {
                roleName: roleInfo.roleName,
                maxConcurrency: roleInfo.maxConcurrency,
                containers: [],
              };
            }
          }

          // Stop tailing containers that no longer exist
          for (const name of activeTails.keys()) {
            if (!activeNames.has(name)) {
              stopTailing(name);
            }
          }

          send('status', { roles });
        } catch {}
      }

      // Initial poll
      await pollStatus();

      // Poll every 3s
      const statusInterval = setInterval(pollStatus, 3000);

      // Keepalive every 15s
      const keepaliveInterval = setInterval(() => {
        send('ping', {});
      }, 15000);

      // Cleanup on abort
      signal.addEventListener('abort', () => {
        clearInterval(statusInterval);
        clearInterval(keepaliveInterval);
        for (const name of activeTails.keys()) {
          stopTailing(name);
        }
        try { streamController.close(); } catch {}
      });
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
