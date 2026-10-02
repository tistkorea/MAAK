// 운영 분석: 조리시간·지연율·스테이션/메뉴별 품질 지표
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

r.get('/summary', async (req, res) => {
  const org = await assertOrgAccess(req.user, Number(req.query.orgId || req.user.orgId));
  const { from, to } = range(req);
  const storeIds = org.type === 'store' ? [org.id] : await storeIdsUnder(org);
  const tz = config.timezone;
  // $1 매장들, $2 시작일, $3 종료일, $4 타임존
  const base = `o.store_id = ANY($1) AND o.created_at >= ($2::date)::timestamp AT TIME ZONE $4
                AND o.created_at < ($3::date + 1)::timestamp AT TIME ZONE $4`;
  const p = [storeIds, from, to, tz];

  const [kpi, stations, menus, hourly, stores] = await Promise.all([
    query(`SELECT count(*) AS orders,
                  count(*) FILTER (WHERE status = 'served') AS served,
                  count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
                  round(avg(extract(epoch FROM ready_at - created_at)))::int AS avg_ticket_sec,
                  round(avg(extract(epoch FROM served_at - ready_at)))::int AS avg_pass_sec,
                  round(100.0 * count(*) FILTER (WHERE ready_at - created_at > make_interval(mins => target_minutes))
                        / NULLIF(count(*) FILTER (WHERE ready_at IS NOT NULL), 0), 1) AS late_rate
             FROM orders o WHERE ${base}`, p),
    // 여러 매장 집계 시 같은 조리 파트 유형끼리 묶는다
    query(`SELECT s.type AS id, min(s.name) AS name, min(s.color) AS color, sum(i.qty) AS qty,
                  round(avg(extract(epoch FROM i.done_at - o.created_at)))::int AS avg_total_sec,
                  round(avg(extract(epoch FROM i.done_at - i.started_at)))::int AS avg_cook_sec,
                  round(100.0 * count(*) FILTER (WHERE i.done_at - o.created_at > make_interval(mins => i.target_minutes))
                        / NULLIF(count(*) FILTER (WHERE i.done_at IS NOT NULL), 0), 1) AS late_rate
             FROM order_items i JOIN orders o ON o.id = i.order_id JOIN stations s ON s.id = i.station_id
            WHERE ${base} AND i.status <> 'cancelled'
            GROUP BY s.type ORDER BY min(s.sort_order), 2`, p),
    query(`SELECT i.name, sum(i.qty) AS qty, max(i.target_minutes) AS target_minutes,
                  round(avg(extract(epoch FROM i.done_at - o.created_at)))::int AS avg_total_sec,
                  round(100.0 * count(*) FILTER (WHERE i.done_at - o.created_at > make_interval(mins => i.target_minutes))
                        / NULLIF(count(*) FILTER (WHERE i.done_at IS NOT NULL), 0), 1) AS late_rate
             FROM order_items i JOIN orders o ON o.id = i.order_id
            WHERE ${base} AND i.status <> 'cancelled'
            GROUP BY i.name ORDER BY qty DESC LIMIT 30`, p),
    query(`SELECT extract(hour FROM o.created_at AT TIME ZONE $4)::int AS hour, count(*) AS orders,
                  round(avg(extract(epoch FROM ready_at - created_at)))::int AS avg_ticket_sec
             FROM orders o WHERE ${base} GROUP BY 1 ORDER BY 1`, p),
    org.type === 'store' ? { rows: [] } : query(
      `SELECT st.id, st.name, st.status, b.name AS branch_name, count(o.id) AS orders,
              round(avg(extract(epoch FROM o.ready_at - o.created_at)))::int AS avg_ticket_sec,
              round(100.0 * count(o.id) FILTER (WHERE o.ready_at - o.created_at > make_interval(mins => o.target_minutes))
                    / NULLIF(count(o.id) FILTER (WHERE o.ready_at IS NOT NULL), 0), 1) AS late_rate
         FROM organizations st
         LEFT JOIN organizations b ON b.id = st.parent_id AND b.type = 'branch'
         LEFT JOIN orders o ON o.store_id = st.id AND o.created_at >= ($2::date)::timestamp AT TIME ZONE $4
                           AND o.created_at < ($3::date + 1)::timestamp AT TIME ZONE $4
        WHERE st.id = ANY($1)
        GROUP BY st.id, st.name, st.status, b.name ORDER BY orders DESC`, p),
  ]);

  res.json({
    org: { id: org.id, name: org.name, type: org.type },
    from, to, storeCount: storeIds.length,
    kpi: kpi.rows[0], stations: stations.rows, menus: menus.rows, hourly: hourly.rows, stores: stores.rows,
  });
});

export default r;
