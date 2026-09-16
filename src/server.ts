import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDb } from './db/client.js';

const server = createApp().listen(env.PORT, () => {
  console.log(`auto-mechnica-portal-api listening on :${env.PORT} (${env.NODE_ENV})`);
});

// Persistent process, so shutdown is ours to handle: stop accepting requests,
// then drain the pool rather than dropping in-flight transactions.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      void closeDb().then(() => process.exit(0));
    });
  });
}
