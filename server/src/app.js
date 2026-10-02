import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config.js';
import { query } from './db/pool.js';
import { requireAuth, requirePerm } from './auth/auth.js';
import { HttpError } from './errors.js';
import authRoutes from './routes/auth.js';
import orgRoutes from './routes/orgs.js';
import userRoutes from './routes/users.js';
import storeRoutes from './routes/stores.js';
import orderRoutes from './routes/orders.js';
import menuRoutes from './routes/menus.js';
import posRoutes from './routes/pos.js';
import analyticsRoutes from './routes/analytics.js';
import { notices, auditLogs, system } from './routes/misc.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));
  if (config.env !== 'test') app.use(morgan('tiny'));

  app.get('/api/health', async (_req, res) => {
    await query('SELECT 1');
    res.json({ ok: true, service: 'mps-server', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/pos', posRoutes);

  const api = express.Router();
  api.use(requireAuth);
  api.use('/orgs', requirePerm('org:view'), orgRoutes);
  api.use('/users', requirePerm('user:manage'), userRoutes);
  api.use('/stores/:storeId', storeRoutes);
  api.use('/orders', orderRoutes);
  api.use('/menus', menuRoutes);
  api.use('/analytics', analyticsRoutes);
  api.use('/notices', notices);
  api.use('/audit-logs', auditLogs);
  api.use('/system', system);
  app.use('/api', api);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API를 찾을 수 없습니다')));

  // 단일 서버 배포 시 빌드된 프론트엔드 제공
  if (config.webDist && fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, detail: err.detail });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 형식 오류' });
    if (err.code === '23505') return res.status(409).json({ error: '중복된 값이 있습니다', detail: err.detail });
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  });
  return app;
}
