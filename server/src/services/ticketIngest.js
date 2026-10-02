// 주방프린터 전표(raw) → 파싱 → 주문 생성/취소
import { config } from '../config.js';
import { decodeTicket, parseKitchenTicket } from './printerParser.js';
import { cancelByPosOrderNo, createOrder } from './orderService.js';
import { emitStore } from '../realtime/socket.js';

export async function ingestTicket(storeId, raw, { encoding = config.printerEncoding, dryRun = false, userId = null, externalId } = {}) {
  const text = decodeTicket(raw, encoding);
  const parsed = parseKitchenTicket(text);
  const memo = [...parsed.memo, ...parsed.unparsed.map((l) => `[미확인] ${l}`)].join(' / ') || null;

  if (dryRun) return { parsed, text, action: 'preview' };

  if (parsed.isCancel) {
    if (!parsed.posOrderNo) return { parsed, action: 'ignored', reason: '취소 전표에 주문번호가 없습니다' };
    const cancelled = await cancelByPosOrderNo(storeId, parsed.posOrderNo);
    for (const o of cancelled) emitStore(storeId, 'order:updated', o);
    return { parsed, action: 'cancelled', orders: cancelled.map((o) => o.id) };
  }
  if (!parsed.items.length) return { parsed, action: 'ignored', reason: '주문 품목을 찾지 못했습니다' };

  const { order, duplicate } = await createOrder(storeId, {
    source: 'printer',
    externalId,
    posOrderNo: parsed.posOrderNo,
    tableNo: parsed.tableNo,
    orderType: parsed.orderType,
    rush: parsed.rush,
    memo,
    rawTicket: text,
    items: parsed.items,
  }, userId);
  if (!duplicate) emitStore(storeId, 'order:created', order);
  return { parsed, action: duplicate ? 'duplicate' : 'created', order };
}
