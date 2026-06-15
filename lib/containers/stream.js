import { auth } from '../auth/index.js';
import { listNetworkContainers, getContainerStats } from '../tools/docker.js';

export async function GET(request) {
  const session = await auth();
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }
  // The container status dashboard is admin-only infra: it lists every container
  // on the network. Non-admins must not enumerate them.
  if (session.user.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }

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

      async function poll() {
        if (signal.aborted) return;
        try {
          const containers = await listNetworkContainers();

          // Fetch stats for running containers in parallel
          const withStats = await Promise.all(
            containers.map(async (c) => {
              if (c.state === 'running') {
                const stats = await getContainerStats(c.name);
                return { ...c, stats };
              }
              return { ...c, stats: null };
            })
          );

          send('containers', withStats);
        } catch {}
      }

      // Initial push
      await poll();

      // Poll every 3s
      const interval = setInterval(poll, 3000);

      // Keepalive every 15s
      const keepalive = setInterval(() => send('ping', {}), 15000);

      signal.addEventListener('abort', () => {
        clearInterval(interval);
        clearInterval(keepalive);
        try { streamController.close(); } catch {}
      });
    },
    cancel() {
      controller.abort();
    },
  });

  request.signal?.addEventListener('abort', () => controller.abort());

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
