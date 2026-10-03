// 매장 단위 API: 스테이션, 매장 메뉴, 주문, 디바이스, 프린터 파서 테스트
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { generateDeviceKey, hashKey, requirePerm } from '../auth/auth.js';
import { badRequest, notFound, parse } from '../errors.js';
import { assertStoreAccess } from '../services/scope.js';
import { audit } from '../services/audit.js';
import { createOrder, listOrders, loadStations, loadStoreMenu } from '../services/orderService.js';
import { ingestTicket } from '../services/ticketIngest.js';
import { emitStore } from '../realtime/socket.js';

const r = Router({ mergeParams: true });

// 모든 하위 경로에서 매장 접근 범위 확인
r.use(async (req, _res, next) => {
  req.store = await assertStoreAccess(req.user, Number(req.params.storeId));
  next();
});

// ---------- 스테이션 ----------
r.get('/stations', async (req, res) => {
  res.json(await loadStations(req.store.id));
});

const stationBody = z.object({
  name: z.string().min(1).max(40),
  type: z.string().min(1).max(30),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isExpo: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

r.post('/stations', requirePerm('station:manage'), async (req, res) => {
  const b = parse(stationBody, req.body);
  if (b.isDefault) await query('UPDATE stations SET is_default = false WHERE store_id = $1', [req.store.id]);
  const { rows } = await query(
    `INSERT INTO stations (store_id, name, type, color, is_expo, is_default, sort_order)
     VALUES ($1,$2,$3,COALESCE($4,'#3b82f6'),$5,$6,$7) RETURNING *`,
    [req.store.id, b.name, b.type, b.color ?? null, Boolean(b.isExpo), Boolean(b.isDefault), b.sortOrder ?? 0],
  );
  await audit(req, 'station.create', { entity: 'station', entityId: rows[0].id, orgId: req.store.id, detail: b });
  emitStore(req.store.id, 'stations:changed', {});
  res.status(201).json(rows[0]);
});

r.patch('/stations/:id', requirePerm('station:manage'), async (req, res) => {
  const b = parse(stationBody.partial().extend({ active: z.boolean().optional() }), req.body);
  if (b.isDefault) await query('UPDATE stations SET is_default = false WHERE store_id = $1', [req.store.id]);
  const { rows } = await query(
    `UPDATE stations SET name = COALESCE($3, name), type = COALESCE($4, type), color = COALESCE($5, color),
            is_expo = COALESCE($6, is_expo), is_default = COALESCE($7, is_default),
            sort_order = COALESCE($8, sort_order), active = COALESCE($9, active)
      WHERE id = $1 AND store_id = $2 RETURNING *`,
    [Number(req.params.id), req.store.id, b.name ?? null, b.type ?? null, b.color ?? null, b.isExpo ?? null,
      b.isDefault ?? null, b.sortOrder ?? null, b.active ?? null],
  );
  if (!rows[0]) throw notFound('스테이션을 찾을 수 없습니다');
  await audit(req, 'station.update', { entity: 'station', entityId: rows[0].id, orgId: req.store.id, detail: b });
  emitStore(req.store.id, 'stations:changed', {});
  res.json(rows[0]);
});

// ---------- 매장 메뉴 운영 ----------
r.get('/menu', async (req, res) => {
  res.json(await loadStoreMenu(req.store.id));
});

r.put('/menu/:menuItemId', requirePerm('menu:store'), async (req, res) => {
  const b = parse(z.object({
    soldOut: z.boolean().optional(),
    stationId: z.number().int().nullable().optional(),
    price: z.number().int().min(0).nullable().optional(),
  }), req.body);
  const menuItemId = Number(req.params.menuItemId);
  const menu = await loadStoreMenu(req.store.id);
  const current = menu.find((m) => m.id === menuItemId);
  if (!current) throw notFound('매장 메뉴에 없는 항목입니다');
  if (b.stationId) {
    const st = await query('SELECT 1 FROM stations WHERE id = $1 AND store_id = $2', [b.stationId, req.store.id]);
    if (!st.rows[0]) throw badRequest('이 매장의 스테이션이 아닙니다');
  }
  await query(
    `INSERT INTO store_menu_items (store_id, menu_item_id, sold_out, station_id, price)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (store_id, menu_item_id) DO UPDATE SET sold_out = $3, station_id = $4, price = $5`,
    [req.store.id, menuItemId, b.soldOut ?? current.sold_out,
      b.stationId !== undefined ? b.stationId : current.station_override,
      b.price !== undefined ? b.price : (current.price !== current.base_price ? current.price : null)],
  );
  await audit(req, 'store_menu.update', { entity: 'menu_item', entityId: menuItemId, orgId: req.store.id, detail: b });
  emitStore(req.store.id, 'menu:changed', { menuItemId });
  res.json({ ok: true });
});

// ---------- 주문 ----------
r.get('/orders', requirePerm('kds:operate'), async (req, res) => {
  res.json(await listOrders(req.store.id, {
    scope: req.query.scope === 'all' ? 'all' : 'active',
    date: req.query.date,
  }));
});

export const orderInput = z.object({
  externalId: z.string().max(80).optional().nullable(),
  posOrderNo: z.string().max(40).optional().nullable(),
  tableNo: z.string().max(20).optional().nullable(),
  guestCount: z.number().int().min(1).max(200).optional().nullable(),
  orderType: z.enum(['dine_in', 'takeout', 'delivery']).optional(),
  memo: z.string().max(500).optional().nullable(),
  rush: z.boolean().optional(),
  items: z.array(z.object({
    menuItemId: z.number().int().optional().nullable(),
    code: z.string().max(40).optional().nullable(),
    name: z.string().min(1).max(100),
    qty: z.number().int().min(1).max(999),
    options: z.string().max(300).optional().nullable(),
  })).min(1),
});

r.post('/orders', requirePerm('order:create'), async (req, res) => {
  const b = parse(orderInput.extend({ channel: z.enum(['manual', 'pos', 'table_order']).optional() }), req.body);
  const { order } = await createOrder(req.store.id, { ...b, source: b.channel || 'manual' }, req.user.id);
  emitStore(req.store.id, 'order:created', order);
  await audit(req, 'order.create', { entity: 'order', entityId: order.id, orgId: req.store.id });
  res.status(201).json(order);
});

// 주방프린터 출력 텍스트를 붙여넣어 파싱 결과 확인 (commit=true 이면 실제 주문 생성)
r.post('/print-test', requirePerm('order:create'), async (req, res) => {
  const b = parse(z.object({ text: z.string().min(1).max(20000), commit: z.boolean().optional() }), req.body);
  const result = await ingestTicket(req.store.id, Buffer.from(b.text, 'utf8'), {
    encoding: 'utf-8', dryRun: !b.commit, userId: req.user.id,
  });
  res.json(result);
});

// ---------- 직원 호출 / 고객 요청 ----------
export const requestInput = z.object({
  type: z.enum(['staff_call', 'customer_request']),
  tableNo: z.string().max(20).optional().nullable(),
  orderId: z.number().int().optional().nullable(),
  category: z.string().max(30).optional().nullable(),
  message: z.string().max(300).optional().nullable(),
});

export async function createRequest(storeId, b, { source, userId }) {
  const { rows } = await query(
    `INSERT INTO service_requests (store_id, table_no, order_id, type, category, message, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [storeId, b.tableNo || null, b.orderId || null, b.type, b.category || null, b.message || null, source, userId ?? null]);
  emitStore(storeId, 'request:changed', rows[0]);
  return rows[0];
}

r.get('/requests', requirePerm('kds:operate'), async (req, res) => {
  const { rows } = await query(
    `SELECT q.*, u.name AS handled_by_name FROM service_requests q LEFT JOIN users u ON u.id = q.handled_by
      WHERE q.store_id = $1 AND (q.status IN ('open','ack') OR q.created_at > now() - interval '30 minutes')
      ORDER BY q.created_at`, [req.store.id]);
  res.json(rows);
});

r.post('/requests', requirePerm('kds:operate'), async (req, res) => {
  const b = parse(requestInput, req.body);
  res.status(201).json(await createRequest(req.store.id, b, { source: 'staff', userId: req.user.id }));
});

r.patch('/requests/:id', requirePerm('kds:operate'), async (req, res) => {
  const b = parse(z.object({ status: z.enum(['ack', 'done', 'cancelled']) }), req.body);
  const { rows } = await query(
    `UPDATE service_requests SET status = $3::text, handled_by = $4,
            ack_at = COALESCE(ack_at, now()),
            done_at = CASE WHEN $3::text IN ('done','cancelled') THEN now() ELSE done_at END
      WHERE id = $1 AND store_id = $2 AND status IN ('open','ack') RETURNING *`,
    [Number(req.params.id), req.store.id, b.status, req.user.id]);
  if (!rows[0]) throw notFound('처리 가능한 요청이 없습니다');
  emitStore(req.store.id, 'request:changed', rows[0]);
  res.json(rows[0]);
});

// ---------- 디바이스(POS / 프린터 에이전트) ----------
r.get('/devices', requirePerm('device:manage'), async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, type, key_prefix, active, last_seen_at, created_at FROM devices
      WHERE store_id = $1 ORDER BY id`, [req.store.id]);
  res.json(rows);
});

r.post('/devices', requirePerm('device:manage'), async (req, res) => {
  const b = parse(z.object({ name: z.string().min(1).max(60), type: z.enum(['pos', 'printer_agent', 'kds', 'table_order']) }), req.body);
  const key = generateDeviceKey();
  const { rows } = await query(
    `INSERT INTO devices (store_id, name, type, key_prefix, key_hash) VALUES ($1,$2,$3,$4,$5)
     RETURNING id, name, type, key_prefix, active, created_at`,
    [req.store.id, b.name, b.type, key.slice(0, 10), hashKey(key)],
  );
  await audit(req, 'device.create', { entity: 'device', entityId: rows[0].id, orgId: req.store.id, detail: b });
  // 원본 키는 생성 시 한 번만 노출
  res.status(201).json({ ...rows[0], key });
});

r.patch('/devices/:id', requirePerm('device:manage'), async (req, res) => {
  const b = parse(z.object({ active: z.boolean() }), req.body);
  const { rows } = await query(
    'UPDATE devices SET active = $3 WHERE id = $1 AND store_id = $2 RETURNING id, name, type, key_prefix, active',
    [Number(req.params.id), req.store.id, b.active],
  );
  if (!rows[0]) throw notFound('디바이스를 찾을 수 없습니다');
  await audit(req, 'device.update', { entity: 'device', entityId: rows[0].id, orgId: req.store.id, detail: b });
  res.json(rows[0]);
});

export default r;
