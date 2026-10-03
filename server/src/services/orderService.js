// 주문 수신 → 주방 파트(스테이션) 라우팅 → 조리 → 호출 → 완료(제공) 상태 관리
// 품목은 수량 단위로 진행(일부완료·부분취소)되며, 모든 변경은 order_item_events 에 작업자와 함께 기록된다.
import { config } from '../config.js';
import { query, tx } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { normalizeName } from './printerParser.js';
import { hqOf, getOrg } from './scope.js';

export const ACTIVE_STATUSES = ['received', 'cooking', 'ready'];
// 품목 상태: 대기 / 조리중 / 일부완료 / 호출(조리완료·홀 픽업 호출) / 완료(제공) / 취소
export const ITEM_STATUSES = ['pending', 'cooking', 'partial', 'ready', 'served', 'cancelled'];
const ITEM_OPEN = ['pending', 'cooking', 'partial', 'ready'];

// 매장 메뉴(본부 마스터 + 매장 운영값)
export async function loadStoreMenu(storeId, db = { query }) {
  const store = await getOrg(storeId);
  const hq = store && (await hqOf(store));
  if (!hq) return [];
  const { rows } = await db.query(
    `SELECT m.id, m.code, m.name, m.aliases, m.station_type, m.target_minutes, m.min_minutes, m.recipe, m.allergens,
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

async function logEvent(client, e) {
  await client.query(
    `INSERT INTO order_item_events (store_id, order_id, item_id, event, qty, user_id, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [e.storeId, e.orderId, e.itemId ?? null, e.event, e.qty ?? null, e.userId ?? null, e.reason ?? null],
  );
}

/**
 * 주문 생성
 * input: { source, externalId, posOrderNo, tableNo, guestCount, orderType, memo, rush, rawTicket,
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
        minMinutes: m?.min_minutes ?? null,
      };
    });
    const target = Math.max(...lines.map((l) => l.targetMinutes));
    const displayNo = input.posOrderNo || (await nextDisplayNo(client, storeId));

    const { rows } = await client.query(
      `INSERT INTO orders (store_id, display_no, source, external_id, pos_order_no, table_no, guest_count, order_type,
                           rush, memo, target_minutes, raw_ticket, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [storeId, displayNo, input.source || 'manual', input.externalId || null, input.posOrderNo || null,
        input.tableNo || null, input.guestCount || null, input.orderType || 'dine_in', Boolean(input.rush),
        input.memo || null, target, input.rawTicket || null, userId],
    );
    const orderId = rows[0].id;
    for (const l of lines) {
      const { rows: [it] } = await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, station_id, name, qty, options, target_minutes, min_minutes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [orderId, l.menuItemId, l.stationId, l.name, l.qty, l.options, l.targetMinutes, l.minMinutes],
      );
      await logEvent(client, { storeId, orderId, itemId: it.id, event: 'received', qty: l.qty, userId });
    }
    return { order: await getOrder(orderId, client), duplicate: false };
  });
}

const ITEM_SELECT = `SELECT i.*, (i.qty - i.cancel_qty) AS live_qty, s.name AS station_name, s.color AS station_color,
                            u.name AS done_by_name
                       FROM order_items i LEFT JOIN stations s ON s.id = i.station_id
                       LEFT JOIN users u ON u.id = i.done_by`;

export async function getOrder(id, db = { query }) {
  const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const items = await db.query(`${ITEM_SELECT} WHERE i.order_id = $1 ORDER BY i.id`, [id]);
  return { ...rows[0], items: items.rows };
}

export async function listOrders(storeId, { scope = 'active', date, limit = 300 } = {}) {
  const params = [storeId];
  let where = 'o.store_id = $1';
  if (scope === 'active') {
    // 진행 중 + 최근 30분 내 종료(완료/취소) 주문(되돌리기 대비)
    where += ` AND (o.status IN ('received','cooking','ready')
                    OR (o.status = 'served' AND o.served_at > now() - interval '30 minutes')
                    OR (o.status = 'cancelled' AND o.cancelled_at > now() - interval '30 minutes'))`;
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
  const { rows: items } = await query(`${ITEM_SELECT} WHERE i.order_id = ANY($1) ORDER BY i.id`, [orders.map((o) => o.id)]);
  const byOrder = new Map(orders.map((o) => [o.id, { ...o, items: [] }]));
  for (const it of items) byOrder.get(it.order_id).items.push(it);
  return [...byOrder.values()].reverse(); // 오래된 주문 먼저 (조리 순서)
}

// 조리 진행 이력 (메뉴별 진행 관리 화면)
export async function getOrderEvents(orderId) {
  const { rows } = await query(
    `SELECT e.*, u.name AS user_name, i.name AS item_name
       FROM order_item_events e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN order_items i ON i.id = e.item_id
      WHERE e.order_id = $1 ORDER BY e.id`,
    [orderId],
  );
  return rows;
}

// 품목 상태로 주문 상태 재계산
async function recompute(client, orderId) {
  const { rows: [o] } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!o || o.status === 'cancelled') return;
  const { rows: items } = await client.query('SELECT status FROM order_items WHERE order_id = $1', [orderId]);
  const live = items.filter((i) => i.status !== 'cancelled');
  let status;
  if (!live.length) status = 'cancelled';
  else if (live.every((i) => i.status === 'served')) status = 'served';
  else if (live.every((i) => i.status === 'ready' || i.status === 'served')) status = 'ready';
  else if (live.some((i) => i.status !== 'pending')) status = 'cooking';
  else status = 'received';
  await client.query(
    `UPDATE orders SET status = $2::text,
        started_at = CASE WHEN $2::text IN ('cooking','ready','served') THEN COALESCE(started_at, now()) ELSE started_at END,
        ready_at = CASE WHEN $2::text IN ('ready','served') THEN COALESCE(ready_at, now()) ELSE NULL END,
        served_at = CASE WHEN $2::text = 'served' THEN COALESCE(served_at, now()) ELSE NULL END,
        cancelled_at = CASE WHEN $2::text = 'cancelled' THEN now() ELSE cancelled_at END
      WHERE id = $1`,
    [orderId, status],
  );
}

async function lockItem(client, itemId) {
  const { rows: [it] } = await client.query(
    `SELECT i.*, o.status AS order_status, o.store_id FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE i.id = $1 FOR UPDATE OF i`, [itemId]);
  if (!it) throw notFound('주문 품목을 찾을 수 없습니다');
  if (it.order_status === 'cancelled') throw conflict('취소된 주문입니다');
  return it;
}

async function lockOrder(client, orderId) {
  const { rows: [o] } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!o) throw notFound('주문을 찾을 수 없습니다');
  return o;
}

// 품목 상태 기록 (타임스탬프 규칙 일괄 적용)
async function writeItem(client, it, { status, doneQty = it.done_qty, cancelQty = it.cancel_qty, reason }, userId) {
  await client.query(
    `UPDATE order_items SET status = $2::text, done_qty = $3, cancel_qty = $4,
        started_at = CASE WHEN $2::text = 'pending' THEN NULL
                          WHEN $2::text IN ('cooking','partial','ready','served') THEN COALESCE(started_at, now())
                          ELSE started_at END,
        done_at = CASE WHEN $2::text IN ('ready','served') THEN COALESCE(done_at, now()) ELSE NULL END,
        done_by = CASE WHEN $2::text IN ('ready','served') THEN COALESCE(done_by, $5::int)
                       WHEN $2::text = 'partial' THEN $5::int ELSE NULL END,
        served_at = CASE WHEN $2::text = 'served' THEN COALESCE(served_at, now()) ELSE NULL END,
        cancel_reason = COALESCE($6, cancel_reason)
      WHERE id = $1`,
    [it.id, status, doneQty, cancelQty, userId, reason ?? null],
  );
}

// 진행 수량(doneQty)에 맞는 상태
function statusForDone(doneQty, liveQty, started) {
  if (doneQty >= liveQty) return 'ready';
  if (doneQty > 0) return 'partial';
  return started ? 'cooking' : 'pending';
}

/**
 * 품목 처리
 *  action: pending(대기) | cooking(조리중) | progress(진행수량 지정 → 일부완료/호출) | ready(호출)
 *          | served(완료) | cancel(취소, qty 지정 시 부분취소) | recall(되돌리기)
 */
export async function itemAction(itemId, action, userId, { qty, doneQty, reason } = {}) {
  return tx(async (client) => {
    const it = await lockItem(client, itemId);
    const live = it.qty - it.cancel_qty;
    const ev = { storeId: it.store_id, orderId: it.order_id, itemId: it.id, userId };
    if (it.status === 'cancelled') throw conflict('취소된 품목입니다');

    switch (action) {
      case 'pending':
        if (!['cooking'].includes(it.status) || it.done_qty > 0) throw conflict('조리를 시작한 품목만 대기로 돌릴 수 있습니다');
        await writeItem(client, it, { status: 'pending' }, userId);
        await logEvent(client, { ...ev, event: 'pending', qty: live });
        break;
      case 'start':
      case 'cooking':
        if (it.status === 'pending') {
          await writeItem(client, it, { status: 'cooking' }, userId);
          await logEvent(client, { ...ev, event: 'cooking', qty: live });
          break;
        }
        if (['partial', 'cooking'].includes(it.status)) throw conflict('이미 조리 중입니다');
      // falls through: 호출/완료 상태에서 조리중 → 되돌리기
      case 'recall':
        if (!['ready', 'served', 'partial'].includes(it.status)) throw conflict(`현재 상태(${it.status})에서는 되돌릴 수 없습니다`);
        await writeItem(client, it, { status: 'cooking', doneQty: 0 }, userId);
        await logEvent(client, { ...ev, event: 'recall', qty: it.done_qty, reason });
        break;
      case 'progress': {
        const n = Number(doneQty);
        if (!Number.isInteger(n) || n < 0 || n > live) throw badRequest(`진행 수량은 0~${live} 사이입니다`);
        if (it.status === 'served') throw conflict('이미 제공 완료된 품목입니다');
        if (n === it.done_qty) break;
        const status = statusForDone(n, live, true);
        await writeItem(client, it, { status, doneQty: n }, userId);
        const delta = n - it.done_qty;
        await logEvent(client, {
          ...ev, event: delta < 0 ? 'recall' : status === 'ready' ? 'ready' : 'partial', qty: Math.abs(delta),
        });
        break;
      }
      case 'done':
      case 'ready':
        if (!['pending', 'cooking', 'partial'].includes(it.status)) throw conflict('조리 중인 품목이 아닙니다');
        await writeItem(client, it, { status: 'ready', doneQty: live }, userId);
        await logEvent(client, { ...ev, event: 'ready', qty: live - it.done_qty });
        break;
      case 'served':
        if (it.status === 'served') throw conflict('이미 제공 완료된 품목입니다');
        await writeItem(client, it, { status: 'served', doneQty: live }, userId);
        await logEvent(client, { ...ev, event: 'served', qty: live });
        break;
      case 'cancel': {
        const open = it.status === 'served' ? 0 : live; // 제공된 수량은 취소 불가
        const n = qty == null ? open : Number(qty);
        if (!Number.isInteger(n) || n < 1 || n > open) throw badRequest(`취소 수량은 1~${open} 사이입니다`);
        const cancelQty = it.cancel_qty + n;
        const newLive = it.qty - cancelQty;
        // 미조리 수량부터 취소하고, 부족하면 조리 완료 수량을 차감
        const done = Math.min(it.done_qty, newLive);
        const status = newLive === 0 ? 'cancelled'
          : statusForDone(done, newLive, it.status !== 'pending');
        await writeItem(client, it, { status, doneQty: done, cancelQty, reason }, userId);
        await logEvent(client, { ...ev, event: newLive === 0 ? 'cancelled' : 'partial_cancel', qty: n, reason });
        break;
      }
      default:
        throw badRequest('알 수 없는 동작입니다');
    }
    await recompute(client, it.order_id);
    return getOrder(it.order_id, client);
  });
}

// 스테이션 단위 일괄 조리완료(Bump → 호출). stationId 가 없으면 주문 전체.
export async function bumpOrder(orderId, stationId, userId) {
  return tx(async (client) => {
    const o = await lockOrder(client, orderId);
    if (!ACTIVE_STATUSES.includes(o.status)) throw conflict('진행 중인 주문이 아닙니다');
    const { rows } = await client.query(
      `SELECT * FROM order_items WHERE order_id = $1 AND status IN ('pending','cooking','partial')
          AND ($2::int IS NULL OR station_id = $2) FOR UPDATE`,
      [orderId, stationId ?? null]);
    for (const it of rows) {
      const live = it.qty - it.cancel_qty;
      await writeItem(client, it, { status: 'ready', doneQty: live }, userId);
      await logEvent(client, { storeId: o.store_id, orderId, itemId: it.id, event: 'ready', qty: live - it.done_qty, userId });
    }
    await recompute(client, orderId);
    return getOrder(orderId, client);
  });
}

// 스테이션 단위 되돌리기(Recall): 조리완료/제공 품목을 다시 조리중으로
export async function recallStation(orderId, stationId, userId = null) {
  return tx(async (client) => {
    const o = await lockOrder(client, orderId);
    if (o.status === 'cancelled') throw conflict('취소된 주문입니다');
    const { rows } = await client.query(
      `SELECT * FROM order_items WHERE order_id = $1 AND status IN ('ready','served','partial')
          AND ($2::int IS NULL OR station_id = $2) FOR UPDATE`,
      [orderId, stationId ?? null]);
    for (const it of rows) {
      await writeItem(client, it, { status: 'cooking', doneQty: 0 }, userId);
      await logEvent(client, { storeId: o.store_id, orderId, itemId: it.id, event: 'recall', qty: it.done_qty, userId });
    }
    await recompute(client, orderId);
    return getOrder(orderId, client);
  });
}

// 패스: 호출된 품목 일괄 제공 완료 (force: 미완료 품목까지)
export async function serveOrder(orderId, { force = false, userId = null } = {}) {
  return tx(async (client) => {
    const o = await lockOrder(client, orderId);
    if (o.status === 'served') throw conflict('이미 서빙 완료된 주문입니다');
    if (o.status === 'cancelled') throw conflict('취소된 주문입니다');
    if (o.status !== 'ready' && !force) throw conflict('조리가 완료되지 않았습니다');
    const { rows } = await client.query(
      `SELECT * FROM order_items WHERE order_id = $1 AND status IN ('pending','cooking','partial','ready') FOR UPDATE`, [orderId]);
    for (const it of rows) {
      await writeItem(client, it, { status: 'served', doneQty: it.qty - it.cancel_qty }, userId);
      await logEvent(client, { storeId: o.store_id, orderId, itemId: it.id, event: 'served', qty: it.qty - it.cancel_qty, userId,
        reason: it.status === 'ready' ? null : '강제 서빙' });
    }
    await recompute(client, orderId);
    return getOrder(orderId, client);
  });
}

export async function unserveOrder(orderId, userId = null) {
  return tx(async (client) => {
    const o = await lockOrder(client, orderId);
    if (o.status !== 'served') throw conflict('서빙 완료 상태가 아닙니다');
    const { rows } = await client.query(`SELECT * FROM order_items WHERE order_id = $1 AND status = 'served' FOR UPDATE`, [orderId]);
    for (const it of rows) {
      await writeItem(client, it, { status: 'ready' }, userId);
      await logEvent(client, { storeId: o.store_id, orderId, itemId: it.id, event: 'ready', qty: it.done_qty, userId, reason: '서빙 되돌림' });
    }
    await recompute(client, orderId);
    return getOrder(orderId, client);
  });
}

// 주문 전체 취소 (이미 제공된 품목은 유지)
export async function cancelOrder(orderId, userId = null, reason = null) {
  return tx(async (client) => {
    const o = await lockOrder(client, orderId);
    if (['served', 'cancelled'].includes(o.status)) throw conflict('이미 종료된 주문입니다');
    const { rows } = await client.query(
      `SELECT * FROM order_items WHERE order_id = $1 AND status IN ('pending','cooking','partial','ready') FOR UPDATE`, [orderId]);
    for (const it of rows) {
      await writeItem(client, it, { status: 'cancelled', doneQty: 0, cancelQty: it.qty, reason }, userId);
      await logEvent(client, { storeId: o.store_id, orderId, itemId: it.id, event: 'cancelled', qty: it.qty - it.cancel_qty, userId, reason });
    }
    await client.query(`UPDATE orders SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [orderId]);
    return getOrder(orderId, client);
  });
}

export async function setRush(orderId, rush, userId = null) {
  return tx(async (client) => {
    const o = await lockOrder(client, orderId);
    await client.query('UPDATE orders SET rush = $2 WHERE id = $1', [orderId, rush]);
    await logEvent(client, { storeId: o.store_id, orderId, event: 'rush', userId, reason: rush ? '긴급 지정' : '긴급 해제' });
    return getOrder(orderId, client);
  });
}

// 프린터로 들어온 취소 전표: 같은 POS 주문번호의 오늘 진행 주문을 취소
export async function cancelByPosOrderNo(storeId, posOrderNo) {
  const { rows } = await query(
    `SELECT id FROM orders WHERE store_id = $1 AND pos_order_no = $2 AND status IN ('received','cooking','ready')
       AND created_at > now() - interval '18 hours' ORDER BY id DESC`,
    [storeId, posOrderNo],
  );
  const out = [];
  for (const r of rows) out.push(await cancelOrder(r.id, null, 'POS 취소 전표'));
  return out;
}

export { ITEM_OPEN };
