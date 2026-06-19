import { WebSocketServer, WebSocket } from 'ws';
import { decode } from 'next-auth/jwt';
import { getCodeWorkspaceById } from '../db/code-workspaces.js';
import { getSession } from './terminal-sessions.js';

function readSessionToken(cookieHeader, name) {
  // Parse the cookie header into name/value pairs once.
  const jar = {};
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key) jar[key] = part.slice(eq + 1).trim();
  }

  // NextAuth chunks session JWTs larger than ~4KB into `${name}.0`, `${name}.1`, ...
  // Reassemble the chunks (in index order) when present, mirroring the chunk-name
  // logic in lib/auth/middleware.js so the two stay consistent. Fall back to the
  // single unchunked cookie otherwise.
  if (jar[`${name}.0`] !== undefined) {
    const chunks = [];
    for (let i = 0; jar[`${name}.${i}`] !== undefined; i++) {
      chunks.push(jar[`${name}.${i}`]);
    }
    return chunks.join('');
  }

  return jar[name] !== undefined ? jar[name] : null;
}

async function isAuthenticated(req) {
  const cookies = req.headers.cookie || '';
  const secureName = '__Secure-authjs.session-token';
  const plainName = 'authjs.session-token';
  const isSecure = cookies.includes(secureName);
  const name = isSecure ? secureName : plainName;
  const value = readSessionToken(cookies, name);
  if (!value) return null;

  try {
    const token = await decode({
      token: value,
      secret: process.env.AUTH_SECRET,
      salt: name,
    });
    return token?.sub || null;
  } catch {
    return null;
  }
}

function proxyWebSocket(wss, req, socket, head, container, port) {
  wss.handleUpgrade(req, socket, head, (clientWs) => {
    const backendWs = new WebSocket(`ws://${container}:${port}/ws`, 'tty');
    // Buffer client frames that arrive before the backend socket opens, so the
    // terminal's initial handshake frame isn't silently dropped.
    const pending = [];

    // Close the client socket promptly if the backend never opens (e.g. a cold
    // container whose connect hangs without emitting 'error'). Cleared on the
    // first of open/close/error below.
    const openTimer = setTimeout(() => {
      console.error(`[ws-proxy] backend open timeout: ${container}:${port}`);
      backendWs.terminate();
      clientWs.close();
    }, 15000);

    backendWs.on('open', () => {
      clearTimeout(openTimer);
      console.log(`[ws-proxy] connected: ${container}:${port}`);
      for (const { data, isBinary } of pending) backendWs.send(data, { binary: isBinary });
      pending.length = 0;
    });

    backendWs.on('message', (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
      }
    });

    clientWs.on('message', (data, isBinary) => {
      if (backendWs.readyState === WebSocket.OPEN) {
        backendWs.send(data, { binary: isBinary });
      } else if (backendWs.readyState === WebSocket.CONNECTING) {
        pending.push({ data, isBinary });
      }
    });

    backendWs.on('error', (err) => {
      clearTimeout(openTimer);
      console.error(`[ws-proxy] backend error: ${err.message}`);
      clientWs.close();
    });

    backendWs.on('close', () => {
      clearTimeout(openTimer);
      clientWs.close();
    });
    clientWs.on('error', () => backendWs.close());
    clientWs.on('close', () => backendWs.close());
  });
}

export function attachCodeProxy(server) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on('upgrade', async (req, socket, head) => {
    // Match Claude Code terminal: /code/{id}/ws
    const mainMatch = req.url.match(/^\/code\/([^/]+)\/ws$/);
    // Match shell terminal: /code/{id}/term/{sessionId}/ws
    const termMatch = !mainMatch && req.url.match(/^\/code\/([^/]+)\/term\/([^/]+)\/ws$/);

    if (!mainMatch && !termMatch) return;

    // Defense-in-depth against cross-site WebSocket hijacking: reject upgrades
    // whose Origin host does not match the configured app host. Only enforced
    // when both an Origin header and a configured app host are present, so
    // same-origin browsers and non-browser clients are unaffected.
    const origin = req.headers.origin;
    const appUrl = process.env.AUTH_URL || process.env.APP_URL;
    if (origin && appUrl) {
      let originHost;
      let appHost;
      try {
        originHost = new URL(origin).host;
        appHost = new URL(appUrl).host;
      } catch {
        originHost = appHost = undefined;
      }
      if (originHost && appHost && originHost !== appHost) {
        console.log(`[ws-proxy] rejected: cross-origin upgrade from ${origin}`);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    const userId = await isAuthenticated(req);
    if (!userId) {
      console.log('[ws-proxy] rejected: unauthenticated upgrade');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const codeWorkspaceId = (mainMatch || termMatch)[1];
    const codeWorkspace = getCodeWorkspaceById(codeWorkspaceId);
    if (!codeWorkspace) {
      console.log(`[ws-proxy] rejected: unknown workspace ${codeWorkspaceId}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    if (codeWorkspace.userId !== userId) {
      console.log(`[ws-proxy] rejected: user ${userId} does not own workspace ${codeWorkspaceId}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const container = codeWorkspace.containerName;

    if (mainMatch) {
      proxyWebSocket(wss, req, socket, head, container, 7681);
    } else {
      const sessionId = termMatch[2];
      const session = getSession(codeWorkspaceId, sessionId);
      if (!session) {
        console.log(`[ws-proxy] rejected: unknown session ${sessionId}`);
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      proxyWebSocket(wss, req, socket, head, container, session.port);
    }
  });
}
