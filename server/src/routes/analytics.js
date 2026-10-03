// 운영 분석: 주문·조리 이벤트 데이터로 속도/품질/정확도/메뉴/테이블/인력/수요/유입경로/매장 비교
import { Router } from 'express';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { requirePerm } from '../auth/auth.js';
import { badRequest } from '../errors.js';
import { assertOrgAccess, storeIdsUnder } from '../services/scope.js';

const r = Router();
r.use(requirePerm('analytics:view'));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function range(req) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: config.timezone });
  const from = req.query.from || today;
  const to = req.query.to || from;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw badRequest('날짜 형식은 YYYY-MM-DD 입니다');
  return { from, to };
}

const sec = (expr) => `round(avg(extract(epoch FROM ${expr})))::int`;
const rate = (cond, base) => `round(100.0 * count(*) FILTER (WHERE ${cond}) / NULLIF(count(*) FILTER (WHERE ${base}), 0), 1)`;

r.get('/summary', async (req, res) => {
  const org = await assertOrgAccess(req.user, Number(req.query.orgId || req.user.orgId));
  const { from, to } = range(req);
  const storeIds = org.type === 'store' ? [org.id] : await storeIdsUnder(org);
  // $1 매장들, $2 시작일, $3 종료일, $4 타임존
  const p = [storeIds, from, to, config.timezone];
  const inRange = (col) => `${col} >= ($2::date)::timestamp AT TIME ZONE $4 AND ${col} < ($3::date + 1)::timestamp AT TIME ZONE $4`;
  const base = `o.store_id = ANY($1) AND ${inRange('o.created_at')}`;
  const items = `FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${base}`;
  const cook = 'i.done_at - i.started_at';
  const total = 'i.done_at - o.created_at';

  const q = (sql) => query(sql, p).then((x) => x.rows);
  const [kpi, itemKpi, stations, menus, hourly, heatmap, stores, channels, tables, workers,
    cancels, cancelReasons, requests, pairs] = await Promise.all([
    // ① 속도 · 종합
    q(`SELECT count(*) AS orders,
              count(*) FILTER (WHERE status = 'served') AS served,
              count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
              coalesce(sum(guest_count), 0) AS guests,
              ${sec('ready_at - created_at')} AS avg_ticket_sec,
              ${sec('served_at - ready_at')} AS avg_pass_sec,
              ${rate('ready_at - created_at > make_interval(mins => target_minutes)', 'ready_at IS NOT NULL')} AS late_rate
         FROM orders o WHERE ${base}`),
    q(`WITH per_order AS (
         SELECT o.id, min(i.done_at) AS first_done, max(i.done_at) AS last_done, count(i.done_at) AS n, o.created_at
           ${items} AND i.status <> 'cancelled' GROUP BY o.id, o.created_at)
       SELECT (SELECT ${sec('first_done - created_at')} FROM per_order) AS avg_first_item_sec,
              (SELECT ${sec('last_done - first_done')} FROM per_order WHERE n >= 2) AS avg_sync_gap_sec,
              (SELECT ${sec('i.served_at - i.done_at')} ${items} AND i.served_at IS NOT NULL) AS avg_pickup_sec,
              (SELECT ${sec('i.started_at - o.created_at')} ${items} AND i.started_at IS NOT NULL) AS avg_start_wait_sec,
              (SELECT sum(i.qty) ${items}) AS qty,
              (SELECT sum(i.cancel_qty) ${items}) AS cancel_qty`),
    q(`SELECT s.type AS id, min(s.name) AS name, min(s.color) AS color, sum(i.qty - i.cancel_qty) AS qty,
              ${sec(cook)} AS avg_cook_sec, ${sec(total)} AS avg_total_sec,
              ${sec('i.served_at - i.done_at')} AS avg_pickup_sec,
              ${rate(`${total} > make_interval(mins => i.target_minutes)`, 'i.done_at IS NOT NULL')} AS late_rate
         FROM order_items i JOIN orders o ON o.id = i.order_id JOIN stations s ON s.id = i.station_id
        WHERE ${base} AND i.status <> 'cancelled'
        GROUP BY s.type ORDER BY min(s.sort_order), 2`),
    // ② 품질: 기준시간 범위 준수 (조리시간 = 조리시작 → 조리완료)
    q(`SELECT i.name, sum(i.qty - i.cancel_qty) AS qty, max(i.min_minutes) AS min_minutes, max(i.target_minutes) AS target_minutes,
              ${sec(cook)} AS avg_cook_sec,
              round(stddev_samp(extract(epoch FROM ${cook})))::int AS sd_cook_sec,
              ${sec(total)} AS avg_total_sec,
              ${rate(`${cook} < make_interval(mins => i.min_minutes)`, 'i.done_at IS NOT NULL AND i.min_minutes IS NOT NULL')} AS fast_rate,
              ${rate(`${cook} > make_interval(mins => i.target_minutes)`, 'i.done_at IS NOT NULL')} AS slow_rate,
              ${rate(`${total} > make_interval(mins => i.target_minutes)`, 'i.done_at IS NOT NULL')} AS late_rate,
              sum(i.cancel_qty) AS cancel_qty
         ${items} GROUP BY i.name ORDER BY qty DESC NULLS LAST LIMIT 40`),
    q(`SELECT extract(hour FROM o.created_at AT TIME ZONE $4)::int AS hour, count(*) AS orders,
              ${sec('ready_at - created_at')} AS avg_ticket_sec
         FROM orders o WHERE ${base} GROUP BY 1 ORDER BY 1`),
    // ⑦ 수요: 요일 × 시간대
    q(`SELECT extract(isodow FROM o.created_at AT TIME ZONE $4)::int AS dow,
              extract(hour FROM o.created_at AT TIME ZONE $4)::int AS hour, count(*) AS orders
         FROM orders o WHERE ${base} GROUP BY 1, 2`),
    // ⑨ 매장 비교
    org.type === 'store' ? [] : q(
      `SELECT st.id, st.name, st.status, b.name AS branch_name, count(o.id) AS orders,
              ${sec('o.ready_at - o.created_at')} AS avg_ticket_sec,
              ${sec('o.served_at - o.ready_at')} AS avg_pass_sec,
              round(100.0 * count(o.id) FILTER (WHERE o.ready_at - o.created_at > make_interval(mins => o.target_minutes))
                    / NULLIF(count(o.id) FILTER (WHERE o.ready_at IS NOT NULL), 0), 1) AS late_rate,
              round(100.0 * count(o.id) FILTER (WHERE o.status = 'cancelled') / NULLIF(count(o.id), 0), 1) AS cancel_rate
         FROM organizations st
         LEFT JOIN organizations b ON b.id = st.parent_id AND b.type = 'branch'
         LEFT JOIN orders o ON o.store_id = st.id AND ${inRange('o.created_at')}
        WHERE st.id = ANY($1)
        GROUP BY st.id, st.name, st.status, b.name ORDER BY orders DESC`),
    // ⑧ 유입경로
    q(`SELECT o.source, count(*) AS orders,
              round(avg((SELECT sum(qty) FROM order_items WHERE order_id = o.id)), 1) AS avg_qty,
              ${sec('o.ready_at - o.created_at')} AS avg_ticket_sec,
              round(100.0 * count(*) FILTER (WHERE o.status = 'cancelled') / NULLIF(count(*), 0), 1) AS cancel_rate,
              round(100.0 * count(*) FILTER (WHERE EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = o.id AND x.cancel_qty > 0))
                    / NULLIF(count(*), 0), 1) AS any_cancel_rate
         FROM orders o WHERE ${base} GROUP BY o.source ORDER BY orders DESC`),
    // ⑤ 테이블 · 고객 (인원별)
    q(`SELECT CASE WHEN guest_count IS NULL THEN '미입력' WHEN guest_count >= 5 THEN '5명+' ELSE guest_count || '명' END AS bucket,
              count(*) AS orders,
              round(avg((SELECT sum(qty - cancel_qty) FROM order_items WHERE order_id = o.id)::numeric / NULLIF(guest_count, 0)), 2) AS qty_per_guest,
              ${sec('served_at - created_at')} AS avg_dwell_sec,
              ${sec('ready_at - created_at')} AS avg_ticket_sec
         FROM orders o WHERE ${base} AND order_type = 'dine_in'
        GROUP BY 1 ORDER BY min(coalesce(guest_count, 99))`),
    // ⑥ 인력 · 작업자 (조리 진행 이력 기준)
    q(`WITH ev AS (
         SELECT e.* FROM order_item_events e WHERE e.store_id = ANY($1) AND ${inRange('e.created_at')})
       SELECT u.id, u.name, u.role,
              coalesce(sum(ev.qty) FILTER (WHERE ev.event IN ('ready','partial')), 0) AS cooked_qty,
              coalesce(sum(ev.qty) FILTER (WHERE ev.event = 'served'), 0) AS served_qty,
              count(*) FILTER (WHERE ev.event = 'recall') AS recalls,
              coalesce(sum(ev.qty) FILTER (WHERE ev.event IN ('partial_cancel','cancelled')), 0) AS cancel_qty,
              (SELECT ${sec('i.done_at - i.started_at')} FROM order_items i JOIN orders o ON o.id = i.order_id
                WHERE ${base} AND i.done_by = u.id) AS avg_cook_sec,
              (SELECT ${rate('i.done_at - i.started_at > make_interval(mins => i.target_minutes)', 'i.done_at IS NOT NULL')}
                 FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${base} AND i.done_by = u.id) AS slow_rate
         FROM ev JOIN users u ON u.id = ev.user_id
        GROUP BY u.id, u.name, u.role ORDER BY cooked_qty DESC`),
    // ③ 정확도 · 손실: 취소 시점(조리 전/후)
    q(`SELECT i.name,
              coalesce(sum(e.qty), 0) AS cancel_qty,
              coalesce(sum(e.qty) FILTER (WHERE i.started_at IS NOT NULL AND e.created_at >= i.started_at), 0) AS after_start_qty,
              count(*) FILTER (WHERE e.event = 'partial_cancel') AS partial_events
         FROM order_item_events e JOIN order_items i ON i.id = e.item_id JOIN orders o ON o.id = e.order_id
        WHERE ${base} AND e.event IN ('partial_cancel','cancelled')
        GROUP BY i.name ORDER BY cancel_qty DESC LIMIT 15`),
    q(`SELECT coalesce(e.reason, '사유 미입력') AS reason, sum(e.qty) AS qty, count(*) AS events
         FROM order_item_events e JOIN orders o ON o.id = e.order_id
        WHERE ${base} AND e.event IN ('partial_cancel','cancelled')
        GROUP BY 1 ORDER BY qty DESC LIMIT 10`),
    // 직원 호출 · 고객 요청
    q(`SELECT q.type, coalesce(q.category, '기타') AS category, count(*) AS count,
              ${sec('q.ack_at - q.created_at')} AS avg_ack_sec,
              ${sec('q.done_at - q.created_at')} AS avg_done_sec
         FROM service_requests q WHERE q.store_id = ANY($1) AND ${inRange('q.created_at')}
        GROUP BY 1, 2 ORDER BY count DESC`),
    // ④ 메뉴 조합 (같은 주문에 함께 담긴 메뉴)
    q(`SELECT a.name AS a, b.name AS b, count(DISTINCT a.order_id) AS orders
         FROM order_items a JOIN order_items b ON b.order_id = a.order_id AND a.name < b.name
         JOIN orders o ON o.id = a.order_id
        WHERE ${base} AND a.status <> 'cancelled' AND b.status <> 'cancelled'
        GROUP BY 1, 2 ORDER BY orders DESC LIMIT 10`),
  ]);

  res.json({
    org: { id: org.id, name: org.name, type: org.type },
    from, to, storeCount: storeIds.length,
    kpi: { ...kpi[0], ...itemKpi[0] },
    stations, menus, hourly, heatmap, stores, channels, tables, workers,
    cancels, cancelReasons, requests, pairs,
  });
});

export default r;
