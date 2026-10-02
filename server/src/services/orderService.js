// 주문 수신 → 주방 파트(스테이션) 라우팅 → 조리 → 완료 → 서빙 상태 관리
import { config } from '../config.js';
import { query, tx } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { normalizeName } from './printerParser.js';
import { hqOf, getOrg } from './scope.js';

export const ACTIVE_STATUSES = ['received', 'cooking', 'ready'];

// 매장 메뉴(본부 마스터 + 매장 운영값)
export async function loadStoreMenu(storeId, db = { query }) {
  const store = await getOrg(storeId);
  const hq = store && (await hqOf(store));
  if (!hq) return [];
  const { rows } = await db.query(
    `SELECT m.id, m.code, m.name, m.aliases, m.station_type, m.target_minutes, m.recipe, m.allergens,
            m.description, m.category_id, c.name AS category_name, m.sort_order,
            COALESCE(s.price, m.price) AS price, m.price AS base_price,
            COALESCE(s.sold_out, false) AS sold_out, s.station_id AS station_override
       FROM menu_items m
       LEFT JOIN menu_categories c ON c.id = m.category_id
       LEFT JOIN store_menu_items s ON s.menu_item_id = m.id AND s.store_id = $2
      WHERE m.hq_id = $1 AND m.active
      ORDER BY c.sort_order NULLS LAST, m.sort_order, m.name`,
    [hq.id, storeId],
  );
  return rows;
}

export async function loadStations(storeId, db = { query }) {
  const { rows } = await db.query(
    'SELECT * FROM stations WHERE store_id = $1 AND active ORDER BY sort_order, id',
    [storeId],
  );
  return rows;
}

function buildMatcher(menu) {
  const byId = new Map(); const byKey = new Map();
  for (const m of menu) {
    byId.set(m.id, m);
    for (const k of [m.code, m.name, ...(m.aliases || [])]) {
      const n = normalizeName(k);
      if (n && !byKey.has(n)) byKey.set(n, m);
    }
  }
  return (it) => (it.menuItemId && byId.get(it.menuItemId))
    || (it.code && byKey.get(normalizeName(it.code)))
    || byKey.get(normalizeName(it.name))
    || null;
}

// 스테이션 결정: 매장 지정 > 메뉴 기본 파트 유형 > 매장 기본 스테이션 > 첫 조리 스테이션
export function routeStation(menuItem, stations) {
  const cooking = stations.filter((s) => !s.is_expo);
  if (menuItem?.station_override) {
    const s = cooking.find((x) => x.id === menuItem.station_override);
    if (s) return s;
  }
  if (menuItem?.station_type) {
    const s = cooking.find((x) => x.type === menuItem.station_type);
    if (s) return s;
  }
  return cooking.find((s) => s.is_default) || cooking[0] || null;
}

async function nextDisplayNo(client, storeId) {
  // 매장별 일 단위 순번 (동시 생성 시 순번 중복 방지용 advisory lock)
  await client.query('SELECT pg_advisory_xact_lock($1)', [storeId]);
  const { rows } = await client.query(
    `SELECT count(*)::int + 1 AS n FROM orders
      WHERE store_id = $1 AND created_at >= date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2`,
    [storeId, config.timezone],
  );
  return String(rows[0].n).padStart(3, '0');
}

/**
 * 주문 생성
 * input: { source, externalId, posOrderNo, tableNo, orderType, memo, rush, rawTicket,
 *          items: [{ menuItemId?, code?, name, qty, options? }] }
 */
export async function createOrder(storeId, input, userId = null) {
  if (!input.items?.length) throw badRequest('주문 메뉴가 없습니다');
  return tx(async (client) => {
    if (input.externalId) {
      const dup = await client.query('SELECT id FROM orders WHERE store_id = $1 AND external_id = $2', [storeId, input.externalId]);
      if (dup.rows[0]) return { order: await getOrder(dup.rows[0].id, client), duplicate: true };
    }
    const [menu, stations] = await Promise.all([loadStoreMenu(storeId, client), loadStations(storeId, client)]);
    if (!stations.some((s) => !s.is_expo)) throw conflict('매장에 조리 스테이션이 없습니다. 스테이션을 먼저 등록하세요');
    const match = buildMatcher(menu);

    const lines = input.items.map((it) => {
      const m = match(it);
      const station = routeStation(m, stations);
      return {
        menuItemId: m?.id ?? null,
        name: m?.name ?? it.name,
        qty: it.qty || 1,
        options: it.options || null,
        stationId: station?.id ?? null,
        targetMinutes: m?.target_minutes ?? 10,
      };
    });
    const target = Math.max(...lines.map((l) => l.targetMinutes));
    const displayNo = input.posOrderNo || (await nextDisplayNo(client, storeId));

    const { rows } = await client.query(
      `INSERT INTO orders (store_id, display_no, source, external_id, pos_order_no, table_no, order_type,
                           rush, memo, target_minutes, raw_ticket, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [storeId, displayNo, input.source || 'manual', input.externalId || null, input.posOrderNo || null,
        input.tableNo || null, input.orderType || 'dine_in', Boolean(input.rush), input.memo || null,
        target, input.rawTicket || null, userId],
    );
    const orderId = rows[0].id;
    for (const l of lines) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, station_id, name, qty, options, target_minutes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [orderId, l.menuItemId, l.stationId, l.name, l.qty, l.options, l.targetMinutes],
      );
    }
    return { order: await getOrder(orderId, client), duplicate: false };
  });
}

export async function getOrder(id, db = { query }) {
  const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const items = await db.query(
    `SELECT i.*, s.name AS station_name, s.color AS station_color
       FROM order_items i LEFT JOIN stations s ON s.id = i.station_id
      WHERE i.order_id = $1 ORDER BY i.id`,
    [id],
  );
  return { ...rows[0], items: items.rows };
}

export async function listOrders(storeId, { scope = 'active', date, limit = 200 } = {}) {
  const params = [storeId];
  let where = 'o.store_id = $1';
  if (scope === 'active') {
    // 진행 중 + 최근 30분 내 서빙 완료(리콜 대비)
    where += ` AND (o.status IN ('received','cooking','ready') OR (o.status = 'served' AND o.served_at > now() - interval '30 minutes'))`;
  } else if (date) {
    params.push(date, config.timezone);
    where += ` AND o.created_at >= ($2::date)::timestamp AT TIME ZONE $3
               AND o.created_at < ($2::date + 1)::timestamp AT TIME ZONE $3`;
  }
  params.push(limit);
  const { rows: orders } = await query(
    `SELECT o.* FROM orders o WHERE ${where} ORDER BY o.created_at DESC LIMIT $${params.length}`,
    params,
  );
  if (!orders.length) return [];
  const { rows: items } = await query(
    `SELECT i.*, s.name AS station_name, s.color AS station_color
       FROM order_items i LEFT JOIN stations s ON s.id = i.station_id
      WHERE i.order_id = ANY($1) ORDER BY i.id`,
    [orders.map((o) => o.id)],
  );
  const byOrder = new Map(orders.map((o) => [o.id, { ...o, items: [] }]));
  for (const it of items) byOrder.get(it.order_id).items.push(it);
  return [...byOrder.values()].reverse(); // 오래된 주문 먼저 (조리 순서)
}

// 품목 상태에 따라 주문 상태 재계산
async function recompute(client, orderId) {
  const { rows: [o] } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!o || o.status === 'cancelled' || o.status === 'served') return;
  const { rows: items } = await client.query('SELECT status FROM order_items WHERE order_id = $1', [orderId]);
  const live = items.filter((i) => i.status !== 'cancelled');
  let status;
  if (!live.length) status = 'cancelled';
  else if (live.every((i) => i.status === 'done')) status = 'ready';
  else if (live.some((i) => i.status !== 'pending')) status = 'cooking';
  else status = 'received';
  await client.query(
    `UPDATE orders SET status = $2::text,
        started_at = CASE WHEN $2::text IN ('cooking','ready') THEN COALESCE(started_at, now()) ELSE started_at END,
        ready_at = CASE WHEN $2::text = 'ready' THEN COALESCE(ready_at, now()) ELSE NULL END,
        cancelled_at = CASE WHEN $2::text = 'cancelled' THEN now() ELSE cancelled_at END
      WHERE id = $1`,
    [orderId, status],
  );
}

const ITEM_TRANSITIONS = {
  start:  { from: ['pending'], to: 'cooking' },
  done:   { from: ['pending', 'cooking'], to: 'done' },
  recall: { from: ['done'], to: 'cooking' },
  cancel: { from: ['pending', 'cooking', 'done'], to: 'cancelled' },
};

export async function itemAction(itemId, action, userId) {
  const t = ITEM_TRANSITIONS[action];
  if (!t) throw badRequest('알 수 없는 동작입니다');
  return tx(async (client) => {
    const { rows: [it] } = await client.query(
      `SELECT i.*, o.status AS order_status FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE i.id = $1 FOR UPDATE OF i`, [itemId]);
    if (!it) throw notFound('주문 품목을 찾을 수 없습니다');
    if (['served', 'cancelled'].includes(it.order_status)) throw conflict('이미 종료된 주문입니다');
    if (!t.from.includes(it.status)) throw conflict(`현재 상태(${it.status})에서는 처리할 수 없습니다`);
    await client.query(
      `UPDATE order_items SET status = $2::text,
          started_at = CASE WHEN $2::text IN ('cooking','done') THEN COALESCE(started_at, now()) ELSE started_at END,
          done_at = CASE WHEN $2::text = 'done' THEN now() ELSE NULL END,
          done_by = CASE WHEN $2::text = 'done' THEN $3::int ELSE NULL END
        WHERE id = $1`,
      [itemId, t.to, userId],
    );
    await recompute(client, it.order_id);
    return getOrder(it.order_id, client);
  });
}

// 스테이션 단위 일괄 완료(Bump). stationId 가 없으면 주문 전체.
export async function bumpOrder(orderId, stationId, userId) {
  return tx(async (client) => {
    const o = await lockOrder(client, orderId);
    if (!ACTIVE_STATUSES.includes(o.status)) throw conflict('진행 중인 주문이 아닙니다');
    await client.query(
      `UPDATE order_items SET status = 'done', started_at = COALESCE(started_at, now()), done_at = now(), done_by = $3
        WHERE order_id = $1 AND status IN ('pending','cooking') AND ($2::int IS NULL OR station_id = $2)`,
      [orderId, stationId ?? null, userId],
    );
    await recompute(client, orderId);
    return getOrder(orderId, client);
  });
}

// 스테이션 단위 되돌리기(Recall): 해당 파트 완료 품목을 다시 조리중으로
export async function recallStation(orderId, stationId) {
  return tx(async (client) => {
    const o = await lockOrder(client, orderId);
    if (o.status === 'cancelled') throw conflict('취소된 주문입니다');
    if (o.status === 'served') {
      await client.query(`UPDATE orders SET status = 'ready', served_at = NULL WHERE id = $1`, [orderId]);
    }
    await client.query(
      `UPDATE order_items SET status = 'cooking', done_at = NULL, done_by = NULL
        WHERE order_id = $1 AND status = 'done' AND ($2::int IS NULL OR station_id = $2)`,
      [orderId, stationId ?? null],
    );
    await recompute(client, orderId);
    return getOrder(orderId, client);
  });
}

export async function serveOrder(orderId, { force = false } = {}) {
  return tx(async (client) => {
    const o = await lockOrder(client, orderId);
    if (o.status === 'served') throw conflict('이미 서빙 완료된 주문입니다');
    if (o.status === 'cancelled') throw conflict('취소된 주문입니다');
    if (o.status !== 'ready' && !force) throw conflict('조리가 완료되지 않았습니다');
    if (o.status !== 'ready') {
      await client.query(
        `UPDATE order_items SET status = 'done', started_at = COALESCE(started_at, now()), done_at = now()
          WHERE order_id = $1 AND status IN ('pending','cooking')`, [orderId]);
    }
    await client.query(
      `UPDATE orders SET status = 'served', served_at = now(),
              started_at = COALESCE(started_at, now()), ready_at = COALESCE(ready_at, now())
        WHERE id = $1`, [orderId]);
    return getOrder(orderId, client);
  });
}

export async function unserveOrder(orderId) {
  return tx(async (client) => {
    const o = await lockOrder(client, orderId);
    if (o.status !== 'served') throw conflict('서빙 완료 상태가 아닙니다');
    await client.query(`UPDATE orders SET status = 'ready', served_at = NULL WHERE id = $1`, [orderId]);
    return getOrder(orderId, client);
  });
}

export async function cancelOrder(orderId) {
  return tx(async (client) => {
    const o = await lockOrder(client, orderId);
    if (['served', 'cancelled'].includes(o.status)) throw conflict('이미 종료된 주문입니다');
    await client.query(`UPDATE order_items SET status = 'cancelled' WHERE order_id = $1 AND status <> 'done'`, [orderId]);
    await client.query(`UPDATE orders SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [orderId]);
    return getOrder(orderId, client);
  });
}

export async function setRush(orderId, rush) {
  await query('UPDATE orders SET rush = $2 WHERE id = $1', [orderId, rush]);
  return getOrder(orderId);
}

async function lockOrder(client, orderId) {
  const { rows: [o] } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!o) throw notFound('주문을 찾을 수 없습니다');
  return o;
}

// 프린터로 들어온 취소 전표: 같은 POS 주문번호의 오늘 진행 주문을 취소
export async function cancelByPosOrderNo(storeId, posOrderNo) {
  const { rows } = await query(
    `SELECT id FROM orders WHERE store_id = $1 AND pos_order_no = $2 AND status IN ('received','cooking','ready')
       AND created_at > now() - interval '18 hours' ORDER BY id DESC`,
    [storeId, posOrderNo],
  );
  const out = [];
  for (const r of rows) out.push(await cancelOrder(r.id));
  return out;
}
