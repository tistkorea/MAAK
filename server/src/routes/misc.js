// 공지, 감사 로그, 시스템 모니터링
import { Router } from 'express';
import os from 'node:os';
import { z } from 'zod';
import { pool, query } from '../db/pool.js';
import { requirePerm } from '../auth/auth.js';
import { notFound, parse } from '../errors.js';
import { assertOrgAccess } from '../services/scope.js';
import { audit } from '../services/audit.js';
import { realtimeStats } from '../realtime/socket.js';

export const notices = Router();

// 내 상위 조직(본부/지점)이 발행한 공지 + 내 하위 조직이 발행한 공지
notices.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT n.*, o.name AS org_name, o.type AS org_type, u.name AS author_name
       FROM notices n JOIN organizations o ON o.id = n.org_id LEFT JOIN users u ON u.id = n.author_id
      WHERE $1 LIKE o.path || '%' OR o.path LIKE $1 || '%'
      ORDER BY n.pinned DESC, n.created_at DESC LIMIT 100`,
    [req.user.orgPath],
  );
  res.json(rows);
});

notices.post('/', requirePerm('notice:publish'), async (req, res) => {
  const b = parse(z.object({
    orgId: z.number().int().optional(),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(10000),
    pinned: z.boolean().optional(),
  }), req.body);
  const org = await assertOrgAccess(req.user, b.orgId ?? req.user.orgId);
  const { rows } = await query(
    'INSERT INTO notices (org_id, author_id, title, body, pinned) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [org.id, req.user.id, b.title, b.body, Boolean(b.pinned)],
  );
  await audit(req, 'notice.create', { entity: 'notice', entityId: rows[0].id, orgId: org.id, detail: { title: b.title } });
  res.status(201).json(rows[0]);
});

notices.delete('/:id', requirePerm('notice:publish'), async (req, res) => {
  const { rows: [n] } = await query('SELECT * FROM notices WHERE id = $1', [Number(req.params.id)]);
  if (!n) throw notFound();
  await assertOrgAccess(req.user, n.org_id);
  await query('DELETE FROM notices WHERE id = $1', [n.id]);
  await audit(req, 'notice.delete', { entity: 'notice', entityId: n.id, orgId: n.org_id });
  res.json({ ok: true });
});

export const auditLogs = Router();
auditLogs.get('/', requirePerm('audit:view'), async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, u.name AS user_name, u.login_id, o.name AS org_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN organizations o ON o.id = a.org_id
      WHERE (a.org_id IS NULL AND $2) OR o.path LIKE $1 || '%'
      ORDER BY a.id DESC LIMIT $3`,
    [req.user.orgPath, req.user.role === 'developer', Math.min(Number(req.query.limit) || 200, 1000)],
  );
  res.json(rows);
});

export const system = Router();
system.get('/stats', requirePerm('system:manage'), async (_req, res) => {
  const { rows: [counts] } = await query(`SELECT
      (SELECT count(*) FROM organizations WHERE type = 'hq') AS hq,
      (SELECT count(*) FROM organizations WHERE type = 'branch') AS branches,
      (SELECT count(*) FROM organizations WHERE type = 'store') AS stores,
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM devices WHERE active) AS devices,
      (SELECT count(*) FROM orders WHERE created_at > now() - interval '24 hours') AS orders_24h,
      (SELECT count(*) FROM orders WHERE status IN ('received','cooking','ready')) AS active_orders,
      pg_database_size(current_database()) AS db_bytes`);
  const { rows: devices } = await query(
    `SELECT d.id, d.name, d.type, d.last_seen_at, o.name AS store_name FROM devices d
       JOIN organizations o ON o.id = d.store_id WHERE d.active ORDER BY d.last_seen_at DESC NULLS LAST LIMIT 50`);
  res.json({
    counts,
    devices,
    realtime: realtimeStats(),
    process: {
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      node: process.version,
      loadavg: os.loadavg(),
      dbPool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
    },
  });
});
