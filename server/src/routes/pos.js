// 외부 연동 API (디바이스 키 인증)
//  - POST /api/pos/orders : POS 사가 직접 연동하는 JSON 주문
//  - POST /api/pos/print  : 프린터 브릿지 에이전트가 가로챈 주방프린터 ESC/POS 원본
import { Router, raw } from 'express';
import { z } from 'zod';
import { requireDevice } from '../auth/auth.js';
import { badRequest, parse } from '../errors.js';
import { createOrder, cancelByPosOrderNo } from '../services/orderService.js';
import { ingestTicket } from '../services/ticketIngest.js';
import { emitStore } from '../realtime/socket.js';
import { createRequest, orderInput, requestInput } from './stores.js';

const r = Router();
r.use(requireDevice);

r.post('/orders', async (req, res) => {
  const b = parse(orderInput, req.body);
  const source = req.device.type === 'table_order' ? 'table_order' : 'pos';
  const { order, duplicate } = await createOrder(req.device.store_id, { ...b, source });
  if (!duplicate) emitStore(req.device.store_id, 'order:created', order);
  res.status(duplicate ? 200 : 201).json({ id: order.id, displayNo: order.display_no, duplicate });
});

r.post('/orders/cancel', async (req, res) => {
  const b = parse(z.object({ posOrderNo: z.string().min(1) }), req.body);
  const orders = await cancelByPosOrderNo(req.device.store_id, b.posOrderNo);
  for (const o of orders) emitStore(req.device.store_id, 'order:updated', o);
  res.json({ cancelled: orders.map((o) => o.id) });
});

// 테이블오더/POS 에서 직원 호출·고객 요청 전송
r.post('/requests', async (req, res) => {
  const b = parse(requestInput, req.body);
  const source = req.device.type === 'table_order' ? 'table_order' : 'pos';
  const row = await createRequest(req.device.store_id, b, { source });
  res.status(201).json({ id: row.id });
});

// body: application/octet-stream (원본 바이트) 또는 JSON { data: base64, encoding? }
r.post('/print', raw({ type: 'application/octet-stream', limit: '2mb' }), async (req, res) => {
  let buf; let encoding;
  if (Buffer.isBuffer(req.body)) {
    buf = req.body;
    encoding = req.get('x-encoding') || undefined;
  } else if (req.body?.data) {
    buf = Buffer.from(req.body.data, 'base64');
    encoding = req.body.encoding;
  }
  if (!buf?.length) throw badRequest('전표 데이터가 비어 있습니다');
  const result = await ingestTicket(req.device.store_id, buf, {
    encoding, externalId: req.get('x-job-id') || req.body?.jobId || undefined,
  });
  res.status(result.action === 'created' ? 201 : 200).json({
    action: result.action, reason: result.reason, orderId: result.order?.id,
    displayNo: result.order?.display_no, items: result.parsed.items.length,
  });
});

export default r;
