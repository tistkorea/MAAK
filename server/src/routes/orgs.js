import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requirePerm } from '../auth/auth.js';
import { CHILD_ORG_TYPES } from '../auth/rbac.js';
import { badRequest, forbidden, parse } from '../errors.js';
import { assertOrgAccess } from '../services/scope.js';
import { audit } from '../services/audit.js';

const r = Router();

// 내 조직 + 하위 조직 (트리 구성은 클라이언트에서 parent_id 로)
r.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.type, o.parent_id, o.name, o.code, o.address, o.phone, o.status, o.path, o.created_at,
            (SELECT count(*) FROM users u WHERE u.org_id = o.id) AS user_count
       FROM organizations o WHERE o.path LIKE $1 || '%' ORDER BY o.path`,
    [req.user.orgPath],
  );
  res.json(rows);
});

const orgBody = z.object({
  parentId: z.number().int(),
  type: z.enum(['hq', 'branch', 'store']),
  name: z.string().min(1).max(100),
  code: z.string().max(40).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
});

r.post('/', requirePerm('org:manage'), async (req, res) => {
  const body = parse(orgBody, req.body);
  const parent = await assertOrgAccess(req.user, body.parentId);
  if (!CHILD_ORG_TYPES[parent.type].includes(body.type)) {
    throw badRequest(`${parent.type} 하위에는 ${body.type} 조직을 만들 수 없습니다`);
  }
  if (body.type === 'hq' && req.user.role !== 'developer') throw forbidden('가맹본부는 개발팀만 등록할 수 있습니다');
  const { rows } = await query(
    `INSERT INTO organizations (type, parent_id, name, code, address, phone)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [body.type, parent.id, body.name, body.code || null, body.address || null, body.phone || null],
  );
  await audit(req, 'org.create', { entity: 'organization', entityId: rows[0].id, orgId: rows[0].id, detail: body });
  res.status(201).json(rows[0]);
});

r.patch('/:id', requirePerm('org:manage'), async (req, res) => {
  const body = parse(orgBody.omit({ parentId: true, type: true }).partial()
    .extend({ status: z.enum(['active', 'suspended', 'closed']).optional() }), req.body);
  const org = await assertOrgAccess(req.user, Number(req.params.id));
  if (org.id === req.user.orgId && body.status && req.user.role !== 'developer') {
    throw forbidden('자기 조직의 운영 상태는 변경할 수 없습니다');
  }
  const { rows } = await query(
    `UPDATE organizations SET name = COALESCE($2, name), code = COALESCE($3, code),
            address = COALESCE($4, address), phone = COALESCE($5, phone), status = COALESCE($6, status),
            updated_at = now()
      WHERE id = $1 RETURNING *`,
    [org.id, body.name ?? null, body.code ?? null, body.address ?? null, body.phone ?? null, body.status ?? null],
  );
  await audit(req, 'org.update', { entity: 'organization', entityId: org.id, orgId: org.id, detail: body });
  res.json(rows[0]);
});

export default r;
