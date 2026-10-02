// 가맹본부 마스터 메뉴 · 레시피(조리 매뉴얼) · 표준 조리시간
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requirePerm } from '../auth/auth.js';
import { badRequest, conflict, notFound, parse } from '../errors.js';
import { assertOrgAccess, hqOf, getOrg, inScope } from '../services/scope.js';
import { audit } from '../services/audit.js';

const r = Router();

// 대상 본부 결정: hqId 파라미터 또는 내 조직의 상위 본부
async function resolveHq(req, hqId) {
  if (hqId) {
    const org = await getOrg(Number(hqId));
    if (!org || org.type !== 'hq') throw notFound('가맹본부를 찾을 수 없습니다');
    // 하위 조직(지점/매장) 사용자도 소속 본부 메뉴는 조회 가능
    if (!inScope(req.user, org) && !req.user.orgPath.startsWith(org.path)) throw notFound('가맹본부를 찾을 수 없습니다');
    return org;
  }
  const own = await getOrg(req.user.orgId);
  const hq = await hqOf(own);
  if (!hq) throw badRequest('hqId 를 지정하세요');
  return hq;
}

async function assertMasterAccess(req, hqId) {
  const hq = await assertOrgAccess(req.user, hqId);
  if (hq.type !== 'hq') throw badRequest('가맹본부가 아닙니다');
  return hq;
}

r.get('/', requirePerm('menu:view'), async (req, res) => {
  const hq = await resolveHq(req, req.query.hqId);
  const [cats, items] = await Promise.all([
    query('SELECT * FROM menu_categories WHERE hq_id = $1 ORDER BY sort_order, id', [hq.id]),
    query('SELECT * FROM menu_items WHERE hq_id = $1 ORDER BY sort_order, name', [hq.id]),
  ]);
  res.json({ hq: { id: hq.id, name: hq.name }, categories: cats.rows, items: items.rows });
});

r.post('/categories', requirePerm('menu:master'), async (req, res) => {
  const b = parse(z.object({ hqId: z.number().int(), name: z.string().min(1).max(40), sortOrder: z.number().int().optional() }), req.body);
  const hq = await assertMasterAccess(req, b.hqId);
  const { rows } = await query(
    `INSERT INTO menu_categories (hq_id, name, sort_order) VALUES ($1,$2,$3)
     ON CONFLICT (hq_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order RETURNING *`,
    [hq.id, b.name, b.sortOrder ?? 0],
  );
  await audit(req, 'menu.category_upsert', { entity: 'menu_category', entityId: rows[0].id, orgId: hq.id, detail: b });
  res.status(201).json(rows[0]);
});

const itemBody = z.object({
  hqId: z.number().int(),
  categoryId: z.number().int().nullable().optional(),
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(100),
  aliases: z.array(z.string().max(100)).optional(),
  price: z.number().int().min(0).optional(),
  stationType: z.string().min(1).max(30).optional(),
  targetMinutes: z.number().int().min(1).max(180).optional(),
  recipe: z.array(z.string().max(500)).optional(),
  allergens: z.array(z.string().max(40)).optional(),
  description: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

r.post('/items', requirePerm('menu:master'), async (req, res) => {
  const b = parse(itemBody, req.body);
  const hq = await assertMasterAccess(req, b.hqId);
  const dup = await query('SELECT 1 FROM menu_items WHERE hq_id = $1 AND code = $2', [hq.id, b.code]);
  if (dup.rows[0]) throw conflict('이미 존재하는 메뉴 코드입니다');
  const { rows } = await query(
    `INSERT INTO menu_items (hq_id, category_id, code, name, aliases, price, station_type, target_minutes,
                             recipe, allergens, description, active, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [hq.id, b.categoryId ?? null, b.code, b.name, b.aliases ?? [], b.price ?? 0, b.stationType ?? 'main',
      b.targetMinutes ?? 10, JSON.stringify(b.recipe ?? []), b.allergens ?? [], b.description ?? null,
      b.active ?? true, b.sortOrder ?? 0],
  );
  await audit(req, 'menu.item_create', { entity: 'menu_item', entityId: rows[0].id, orgId: hq.id, detail: { code: b.code, name: b.name } });
  res.status(201).json(rows[0]);
});

r.patch('/items/:id', requirePerm('menu:master'), async (req, res) => {
  const b = parse(itemBody.omit({ hqId: true }).partial(), req.body);
  const { rows: [item] } = await query('SELECT * FROM menu_items WHERE id = $1', [Number(req.params.id)]);
  if (!item) throw notFound('메뉴를 찾을 수 없습니다');
  await assertMasterAccess(req, item.hq_id);
  const merged = {
    category_id: b.categoryId !== undefined ? b.categoryId : item.category_id,
    code: b.code ?? item.code,
    name: b.name ?? item.name,
    aliases: b.aliases ?? item.aliases,
    price: b.price ?? item.price,
    station_type: b.stationType ?? item.station_type,
    target_minutes: b.targetMinutes ?? item.target_minutes,
    recipe: JSON.stringify(b.recipe ?? item.recipe),
    allergens: b.allergens ?? item.allergens,
    description: b.description !== undefined ? b.description : item.description,
    active: b.active ?? item.active,
    sort_order: b.sortOrder ?? item.sort_order,
  };
  const { rows } = await query(
    `UPDATE menu_items SET category_id=$2, code=$3, name=$4, aliases=$5, price=$6, station_type=$7,
            target_minutes=$8, recipe=$9, allergens=$10, description=$11, active=$12, sort_order=$13, updated_at=now()
      WHERE id = $1 RETURNING *`,
    [item.id, ...Object.values(merged)],
  );
  await audit(req, 'menu.item_update', { entity: 'menu_item', entityId: item.id, orgId: item.hq_id, detail: b });
  res.json(rows[0]);
});

export default r;
