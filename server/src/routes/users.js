import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { canAssignRole, roleFitsOrg, ROLES } from '../auth/rbac.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../errors.js';
import { assertOrgAccess, inScope } from '../services/scope.js';
import { audit } from '../services/audit.js';

const r = Router();
const roleEnum = z.enum(Object.keys(ROLES));

r.get('/', async (req, res) => {
  const params = [req.user.orgPath];
  let filter = '';
  if (req.query.orgId) {
    params.push(Number(req.query.orgId));
    filter = `AND o.id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT u.id, u.login_id, u.name, u.phone, u.role, u.active, u.org_id, u.last_login_at, u.created_at,
            o.name AS org_name, o.type AS org_type
       FROM users u JOIN organizations o ON o.id = u.org_id
      WHERE o.path LIKE $1 || '%' ${filter}
      ORDER BY o.path, u.role, u.name`,
    params,
  );
  res.json(rows);
});

r.post('/', async (req, res) => {
  const body = parse(z.object({
    orgId: z.number().int(),
    role: roleEnum,
    loginId: z.string().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/, '영문/숫자만 사용'),
    password: z.string().min(6),
    name: z.string().min(1).max(50),
    phone: z.string().max(40).optional().nullable(),
  }), req.body);
  const org = await assertOrgAccess(req.user, body.orgId);
  if (!canAssignRole(req.user.role, body.role)) throw forbidden('본인보다 낮은 역할만 생성할 수 있습니다');
  if (!roleFitsOrg(body.role, org.type)) throw badRequest(`${ROLES[body.role].label} 역할은 ${org.type} 조직에 둘 수 없습니다`);
  const exists = await query('SELECT 1 FROM users WHERE login_id = $1', [body.loginId]);
  if (exists.rows[0]) throw conflict('이미 사용 중인 아이디입니다');
  const { rows } = await query(
    `INSERT INTO users (org_id, role, login_id, password_hash, name, phone)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, org_id, role, login_id, name, phone, active`,
    [org.id, body.role, body.loginId, await bcrypt.hash(body.password, 10), body.name, body.phone || null],
  );
  await audit(req, 'user.create', { entity: 'user', entityId: rows[0].id, orgId: org.id, detail: { role: body.role, loginId: body.loginId } });
  res.status(201).json(rows[0]);
});

r.patch('/:id', async (req, res) => {
  const body = parse(z.object({
    name: z.string().min(1).max(50).optional(),
    phone: z.string().max(40).optional().nullable(),
    role: roleEnum.optional(),
    active: z.boolean().optional(),
    password: z.string().min(6).optional(),
  }), req.body);
  const { rows: [target] } = await query(
    `SELECT u.*, o.path, o.type AS org_type FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = $1`,
    [Number(req.params.id)],
  );
  if (!target || !inScope(req.user, target)) throw notFound('사용자를 찾을 수 없습니다');
  if (target.id === req.user.id) throw forbidden('본인 계정은 여기서 수정할 수 없습니다');
  if (!canAssignRole(req.user.role, target.role)) throw forbidden('상위/동급 역할 사용자는 수정할 수 없습니다');
  if (body.role) {
    if (!canAssignRole(req.user.role, body.role)) throw forbidden('해당 역할을 부여할 수 없습니다');
    if (!roleFitsOrg(body.role, target.org_type)) throw badRequest('조직 유형과 맞지 않는 역할입니다');
  }
  const { rows } = await query(
    `UPDATE users SET name = COALESCE($2, name), phone = COALESCE($3, phone), role = COALESCE($4, role),
            active = COALESCE($5, active), password_hash = COALESCE($6, password_hash)
      WHERE id = $1 RETURNING id, org_id, role, login_id, name, phone, active`,
    [target.id, body.name ?? null, body.phone ?? null, body.role ?? null, body.active ?? null,
      body.password ? await bcrypt.hash(body.password, 10) : null],
  );
  const { password, ...detail } = body;
  await audit(req, 'user.update', { entity: 'user', entityId: target.id, orgId: target.org_id,
    detail: { ...detail, passwordReset: Boolean(password) } });
  res.json(rows[0]);
});

export default r;
