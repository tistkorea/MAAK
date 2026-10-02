import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTicket, parseKitchenTicket, stripEscPos } from '../src/services/printerParser.js';

const TICKET = `
[주방주문서]
테이블: 5   주문번호: 0012
2026-10-02 12:30:11
--------------------
메뉴명          수량
김치찌개          2
  - 덜맵게
제육볶음         x1
2 x 식혜
감자전  1  12,000
--------------------
요청: 수저 2벌 추가
`;

test('주방 주문서 텍스트를 주문으로 파싱', () => {
  const p = parseKitchenTicket(TICKET);
  assert.equal(p.tableNo, '5');
  assert.equal(p.posOrderNo, '0012');
  assert.equal(p.orderType, 'dine_in');
  assert.deepEqual(p.items.map((i) => [i.name, i.qty]), [['김치찌개', 2], ['제육볶음', 1], ['식혜', 2], ['감자전', 1]]);
  assert.equal(p.items[0].options, '덜맵게');
  assert.deepEqual(p.memo, ['수저 2벌 추가']);
  assert.deepEqual(p.unparsed, []);
});

test('포장/취소/긴급 헤더 인식', () => {
  assert.equal(parseKitchenTicket('[포장]\n된장찌개 1').orderType, 'takeout');
  assert.equal(parseKitchenTicket('배달 주문\n된장찌개 1').orderType, 'delivery');
  const c = parseKitchenTicket('*** 주문취소 ***\n주문번호: 77\n된장찌개 1');
  assert.equal(c.isCancel, true);
  assert.equal(c.posOrderNo, '77');
  assert.equal(parseKitchenTicket('[긴급]\n된장찌개 1').rush, true);
});

test('판독 불가 라인은 unparsed 로 보존', () => {
  const p = parseKitchenTicket('김치찌개 1\n알수없는문구');
  assert.deepEqual(p.unparsed, ['알수없는문구']);
});

test('ESC/POS 제어명령 제거 + EUC-KR 디코딩', () => {
  const eucKr = Buffer.from([0xb1, 0xe8, 0xc4, 0xa1, 0xc2, 0xee, 0xb0, 0xb3]); // "김치찌개"
  const raw = Buffer.concat([
    Buffer.from([0x1b, 0x40]),             // ESC @ 초기화
    Buffer.from([0x1d, 0x21, 0x11]),       // GS ! 배확대
    Buffer.from([0x1b, 0x61, 0x01]),       // ESC a 가운데정렬
    eucKr, Buffer.from(' 2\r\n'),
    Buffer.from([0x1d, 0x56, 0x42, 0x00]), // GS V 커트
  ]);
  assert.equal(stripEscPos(raw).includes(0x1b), false);
  const text = decodeTicket(raw, 'euc-kr');
  assert.equal(text.trim(), '김치찌개 2');
  assert.deepEqual(parseKitchenTicket(text).items, [{ name: '김치찌개', qty: 2, options: null }]);
});
