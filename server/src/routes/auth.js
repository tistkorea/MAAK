import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, signToken } from '../auth/auth.js';
import { permissionsOf, ROLES } from '../auth/rbac.js';
import { HttpError, badRequest, parse } from '../errors.js';
import { audit } from '../services/audit.js';

const r = Router();

r.post('/login', async (req, res) => {
  const body = parse(z.object({ loginId: z.string().min(1), password: z.string().min(1) }), req.body);
  const { rows } = await query(
    `SELECT u.*, o.status AS org_status FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.login_id = $1`,
    [body.loginId],
  );
  const u = rows[0];
  if (!u || !u.active || !(await bcrypt.compare(body.password, u.password_hash))) {
    throw new HttpError(401, '아이디 또는 비밀번호가 올바르지 않습니다');
  }
  if (u.org_status !== 'active' && u.role !== 'developer') throw new HttpError(403, '운영이 중지된 조직입니다');
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
  req.user = { id: u.id, orgId: u.org_id };
  await audit(req, 'auth.login', { entity: 'user', entityId: u.id });
  res.json({ token: signToken(u) });
});

r.get('/me', requireAuth, async (req, res) => {
  const u = req.user;
  // 접근 가능한 매장 목록 (KDS 매장 선택용)
  const { rows: stores } = await query(
    `SELECT id, name, code, status FROM organizations
      WHERE type = 'store' AND path LIKE $1 || '%' AND status <> 'closed' ORDER BY name`,
    [u.orgPath],
  );
  res.json({
    user: { ...u, roleLabel: ROLES[u.role].label },
    permissions: permissionsOf(u.role),
    stores,
  });
});

r.post('/password', requireAuth, async (req, res) => {
  const body = parse(z.object({ current: z.string(), next: z.string().min(6) }), req.body);
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(body.current, rows[0].password_hash))) throw badRequest('현재 비밀번호가 다릅니다');
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await bcrypt.hash(body.next, 10)]);
  await audit(req, 'auth.password_change', { entity: 'user', entityId: req.user.id });
  res.json({ ok: true });
});

export default r;
