import 'dotenv/config';
import { createServer } from 'http';
import next from 'next';
import { attachCodeProxy } from 'thepopebot/code/ws-proxy';

const app = next({ dev: false });
const handle = app.getRequestHandler();

// HACK: Prevent Next.js from registering its own WebSocket upgrade handler.
// Without this, Next.js lazily calls setupWebSocketHandler() which uses its
// bundled http-proxy to write "HTTP/1.1 502 Bad Gateway" on already-upgraded
// sockets. No official API exists for this — see docs/HACKS.md.
app.didWebSocketSetup = true;

app.prepare().then(() => {
  const server = createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.statusCode = 500;
      res.end('Internal Server Error');
    });
  });

  attachCodeProxy(server);

  const port = process.env.PORT || 80;
  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
}).catch((err) => {
  console.error('Next prepare failed', err);
  process.exit(1);
});
