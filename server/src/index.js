import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { initRealtime } from './realtime/socket.js';

await migrate();

const server = http.createServer(createApp());
initRealtime(server);

server.listen(config.port, () => {
  console.log(`MPS server listening on :${config.port} (${config.env})`);
});

const shutdown = () => {
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
