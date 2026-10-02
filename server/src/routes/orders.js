// KDS 조리/서빙 처리 API
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requirePerm } from '../auth/auth.js';
import { hasPermission } from '../auth/rbac.js';
import { forbidden, notFound, parse } from '../errors.js';
import { assertStoreAccess } from '../services/scope.js';
import { audit } from '../services/audit.js';
import * as svc from '../services/orderService.js';
import { emitStore } from '../realtime/socket.js';

const r = Router();
r.use(requirePerm('kds:operate'));

async function loadAccessibleOrder(req, orderId) {
  const { rows } = await query('SELECT id, store_id FROM orders WHERE id = $1', [orderId]);
  if (!rows[0]) throw notFound('주문을 찾을 수 없습니다');
  await assertStoreAccess(req.user, rows[0].store_id);
  return rows[0];
}

function publish(order) {
  emitStore(order.store_id, 'order:updated', order);
  return order;
}

r.get('/:id', async (req, res) => {
  await loadAccessibleOrder(req, Number(req.params.id));
  res.json(await svc.getOrder(Number(req.params.id)));
});

// 품목 단위: start(조리시작) / done(완료) / recall(되돌리기) / cancel(취소)
r.post('/items/:itemId/:action', async (req, res) => {
  const itemId = Number(req.params.itemId);
  const { rows } = await query('SELECT order_id FROM order_items WHERE id = $1', [itemId]);
  if (!rows[0]) throw notFound('주문 품목을 찾을 수 없습니다');
  await loadAccessibleOrder(req, rows[0].order_id);
  if (req.params.action === 'cancel' && !hasPermission(req.user.role, 'order:manage')) throw forbidden();
  const order = await svc.itemAction(itemId, req.params.action, req.user.id);
  res.json(publish(order));
});

const stationBody = z.object({ stationId: z.number().int().nullable().optional() });

// 스테이션 티켓 일괄 완료
r.post('/:id/bump', async (req, res) => {
  const o = await loadAccessibleOrder(req, Number(req.params.id));
  const b = parse(stationBody, req.body);
  res.json(publish(await svc.bumpOrder(o.id, b.stationId, req.user.id)));
});

r.post('/:id/recall', async (req, res) => {
  const o = await loadAccessibleOrder(req, Number(req.params.id));
  const b = parse(stationBody, req.body);
  res.json(publish(await svc.recallStation(o.id, b.stationId)));
});

// 패스(Expo): 서빙 완료 / 서빙 취소
r.post('/:id/serve', async (req, res) => {
  const o = await loadAccessibleOrder(req, Number(req.params.id));
  const b = parse(z.object({ force: z.boolean().optional() }), req.body);
  if (b.force && !hasPermission(req.user.role, 'order:manage')) throw forbidden('강제 서빙은 매니저 이상만 가능합니다');
  const order = publish(await svc.serveOrder(o.id, { force: b.force }));
  if (b.force) await audit(req, 'order.force_serve', { entity: 'order', entityId: o.id, orgId: o.store_id });
  res.json(order);
});

r.post('/:id/unserve', async (req, res) => {
  const o = await loadAccessibleOrder(req, Number(req.params.id));
  res.json(publish(await svc.unserveOrder(o.id)));
});

r.post('/:id/cancel', requirePerm('order:manage'), async (req, res) => {
  const o = await loadAccessibleOrder(req, Number(req.params.id));
  const order = publish(await svc.cancelOrder(o.id));
  await audit(req, 'order.cancel', { entity: 'order', entityId: o.id, orgId: o.store_id });
  res.json(order);
});

r.post('/:id/rush', requirePerm('order:manage'), async (req, res) => {
  const o = await loadAccessibleOrder(req, Number(req.params.id));
  const b = parse(z.object({ rush: z.boolean() }), req.body);
  res.json(publish(await svc.setRush(o.id, b.rush)));
});

export default r;
