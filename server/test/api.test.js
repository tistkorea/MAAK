// 통합 테스트: 실제 PostgreSQL 필요 (DATABASE_URL). 테스트 시작 시 DB를 초기화하고 시드한다.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { seed } from '../src/db/seed.js';

process.env.NODE_ENV = 'test';
const app = createApp();
const tokens = {};
let storeId; let otherStoreId; let stations;

async function login(id, pw) {
  const r = await request(app).post('/api/auth/login').send({ loginId: id, password: pw });
  assert.equal(r.status, 200, r.text);
  return r.body.token;
}
const as = (who) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${tokens[who]}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${tokens[who]}`).send(b ?? {}),
  patch: (u, b) => request(app).patch(u).set('Authorization', `Bearer ${tokens[who]}`).send(b ?? {}),
  put: (u, b) => request(app).put(u).set('Authorization', `Bearer ${tokens[who]}`).send(b ?? {}),
});

before(async () => {
  await seed({ reset: true, log: () => {} });
  for (const [k, id, pw] of [['dev', 'dev', 'dev1234'], ['hq', 'hq', 'hq1234'], ['branch', 'branch', 'branch1234'],
    ['branch2', 'branch2', 'branch1234'], ['owner', 'owner', 'owner1234'], ['manager', 'manager', 'manager1234'],
    ['staff', 'staff', 'staff1234']]) {
    tokens[k] = await login(id, pw);
  }
  const me = await as('staff').get('/api/auth/me');
  storeId = me.body.stores[0].id;
  const all = await as('hq').get('/api/orgs');
  otherStoreId = all.body.find((o) => o.type === 'store' && o.id !== storeId).id;
  stations = (await as('staff').get(`/api/stores/${storeId}/stations`)).body;
});

after(() => pool.end());

test('로그인 실패', async () => {
  const r = await request(app).post('/api/auth/login').send({ loginId: 'staff', password: 'x' });
  assert.equal(r.status, 401);
});

test('역할별 권한·조직 범위', async () => {
  const staffMe = (await as('staff').get('/api/auth/me')).body;
  assert.equal(staffMe.stores.length, 1);
  assert.ok(!staffMe.permissions.includes('user:manage'));
  assert.equal((await as('hq').get('/api/auth/me')).body.stores.length, 3);
  // 스텝은 사용자 관리 불가, 타 매장 접근 불가
  assert.equal((await as('staff').get('/api/users')).status, 403);
  assert.equal((await as('staff').get(`/api/stores/${otherStoreId}/stations`)).status, 403);
  // 강원지사장은 서울 강남점 접근 불가
  assert.equal((await as('branch2').get(`/api/stores/${storeId}/orders`)).status, 403);
});

test('사용자 생성 규칙: 하위 역할만, 조직 유형 일치', async () => {
  const ok = await as('manager').post('/api/users', { orgId: storeId, role: 'staff', loginId: 'newstaff', password: 'pass1234', name: '신규' });
  assert.equal(ok.status, 201, ok.text);
  const up = await as('manager').post('/api/users', { orgId: storeId, role: 'store_owner', loginId: 'upuser1', password: 'pass1234', name: 'x' });
  assert.equal(up.status, 403);
  const hqOrgId = (await as('hq').get('/api/auth/me')).body.user.orgId;
  const mismatch = await as('hq').post('/api/users', { orgId: hqOrgId, role: 'manager', loginId: 'mismatch1', password: 'pass1234', name: 'x' });
  assert.equal(mismatch.status, 400);
});

test('주문 → 스테이션 라우팅 → 조리 → 완료 → 서빙', async () => {
  const create = await as('manager').post(`/api/stores/${storeId}/orders`, {
    tableNo: '7', items: [{ name: '김치찌개', qty: 2 }, { name: '제육', qty: 1 }, { name: '없는메뉴', qty: 1 }],
  });
  assert.equal(create.status, 201, create.text);
  const order = create.body;
  const st = (id) => stations.find((s) => s.id === id);
  const [kimchi, jeyuk, unknown] = order.items;
  assert.equal(st(kimchi.station_id).type, 'soup');
  assert.equal(jeyuk.name, '제육볶음'); // 별칭 매칭
  assert.equal(st(jeyuk.station_id).type, 'grill');
  assert.equal(st(unknown.station_id).is_default, true); // 미등록 메뉴는 기본 스테이션
  assert.equal(order.status, 'received');

  let r = await as('staff').post(`/api/orders/items/${kimchi.id}/start`);
  assert.equal(r.body.status, 'cooking');
  assert.equal((await as('staff').post(`/api/orders/${order.id}/serve`)).status, 409); // 미완료 서빙 불가
  await as('staff').post(`/api/orders/${order.id}/bump`, { stationId: kimchi.station_id });
  await as('staff').post(`/api/orders/${order.id}/bump`, { stationId: jeyuk.station_id });
  r = await as('staff').post(`/api/orders/${order.id}/bump`, { stationId: unknown.station_id });
  assert.equal(r.body.status, 'ready');
  assert.ok(r.body.ready_at);

  r = await as('staff').post(`/api/orders/${order.id}/recall`, { stationId: jeyuk.station_id });
  assert.equal(r.body.status, 'cooking');
  r = await as('staff').post(`/api/orders/${order.id}/bump`, { stationId: jeyuk.station_id });
  assert.equal(r.body.status, 'ready');

  r = await as('staff').post(`/api/orders/${order.id}/serve`);
  assert.equal(r.body.status, 'served');
  r = await as('staff').post(`/api/orders/${order.id}/unserve`);
  assert.equal(r.body.status, 'ready');
  // 스텝은 강제 서빙/취소 불가
  assert.equal((await as('staff').post(`/api/orders/${order.id}/cancel`)).status, 403);
});

test('매장 메뉴 스테이션 재지정이 라우팅에 반영', async () => {
  const menu = (await as('manager').get(`/api/stores/${storeId}/menu`)).body;
  const sikhye = menu.find((m) => m.name === '식혜');
  const grill = stations.find((s) => s.type === 'grill');
  assert.equal((await as('manager').put(`/api/stores/${storeId}/menu/${sikhye.id}`, { stationId: grill.id, soldOut: true })).status, 200);
  const o = await as('manager').post(`/api/stores/${storeId}/orders`, { items: [{ code: 'D001', name: '?', qty: 1 }] });
  assert.equal(o.body.items[0].station_id, grill.id);
  const after2 = (await as('manager').get(`/api/stores/${storeId}/menu`)).body.find((m) => m.id === sikhye.id);
  assert.equal(after2.sold_out, true);
});

test('POS 디바이스 키 + 주방프린터 전표 수신 + 취소 전표', async () => {
  const dev = await as('manager').post(`/api/stores/${storeId}/devices`, { name: '카운터 POS 프린터', type: 'printer_agent' });
  assert.equal(dev.status, 201);
  const key = dev.body.key;
  assert.equal((await request(app).post('/api/pos/print').set('X-Device-Key', 'bad').send({})).status, 401);

  const ticket = '[주방]\n테이블: 3  주문번호: P-55\n된장찌개 1\n  - 두부 많이\n막걸리 2\n';
  const r = await request(app).post('/api/pos/print').set('X-Device-Key', key)
    .send({ data: Buffer.from(ticket).toString('base64'), encoding: 'utf-8', jobId: 'job-1' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.action, 'created');
  const dup = await request(app).post('/api/pos/print').set('X-Device-Key', key)
    .send({ data: Buffer.from(ticket).toString('base64'), encoding: 'utf-8', jobId: 'job-1' });
  assert.equal(dup.body.action, 'duplicate');

  const order = (await as('staff').get(`/api/orders/${r.body.orderId}`)).body;
  assert.equal(order.source, 'printer');
  assert.equal(order.table_no, '3');
  assert.equal(order.items[0].options, '두부 많이');

  const cancel = await request(app).post('/api/pos/print').set('X-Device-Key', key)
    .set('Content-Type', 'application/octet-stream').set('X-Encoding', 'utf-8')
    .send(Buffer.from('*** 주문취소 ***\n주문번호: P-55\n된장찌개 1'));
  assert.equal(cancel.body.action, 'cancelled');
  assert.equal((await as('staff').get(`/api/orders/${r.body.orderId}`)).body.status, 'cancelled');

  // JSON 주문 API
  const pos = await request(app).post('/api/pos/orders').set('X-Device-Key', key)
    .send({ externalId: 'POS-1', tableNo: '1', items: [{ code: 'M001', name: '산채비빔밥', qty: 1 }] });
  assert.equal(pos.status, 201, pos.text);
});

test('마스터 메뉴는 본부만 수정', async () => {
  const menus = (await as('staff').get('/api/menus')).body;
  assert.ok(menus.items.length > 5);
  const item = menus.items[0];
  assert.equal((await as('owner').patch(`/api/menus/items/${item.id}`, { targetMinutes: 5 })).status, 403);
  const r = await as('hq').patch(`/api/menus/items/${item.id}`, { targetMinutes: 7, recipe: ['1단계', '2단계'] });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.recipe, ['1단계', '2단계']);
});

test('분석: 매장/본부 단위', async () => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const from = new Date(Date.now() - 7 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const s = await as('owner').get(`/api/analytics/summary?orgId=${storeId}&from=${from}&to=${today}`);
  assert.equal(s.status, 200, s.text);
  assert.ok(s.body.kpi.orders > 100);
  assert.ok(s.body.stations.length >= 4);
  const hqId = (await as('hq').get('/api/auth/me')).body.user.orgId;
  const h = await as('hq').get(`/api/analytics/summary?orgId=${hqId}&from=${from}&to=${today}`);
  assert.equal(h.body.stores.length, 3);
  assert.equal((await as('staff').get('/api/analytics/summary')).status, 403);
});

test('조직 생성 규칙', async () => {
  const branchId = (await as('branch').get('/api/auth/me')).body.user.orgId;
  const r = await as('branch').post('/api/orgs', { parentId: branchId, type: 'store', name: '홍대점' });
  assert.equal(r.status, 201, r.text);
  assert.equal((await as('branch').post('/api/orgs', { parentId: branchId, type: 'branch', name: 'x' })).status, 400);
  assert.equal((await as('owner').post('/api/orgs', { parentId: storeId, type: 'store', name: 'x' })).status, 403);
  // 매장 운영 중지 시 소속 사용자 토큰 차단
  const store = r.body;
  const u = await as('branch').post('/api/users', { orgId: store.id, role: 'store_owner', loginId: 'hongdae', password: 'pass1234', name: '홍대점주' });
  assert.equal(u.status, 201, u.text);
  tokens.hongdae = await login('hongdae', 'pass1234');
  assert.equal((await as('hongdae').get('/api/auth/me')).status, 200);
  await as('branch').patch(`/api/orgs/${store.id}`, { status: 'suspended' });
  assert.equal((await as('hongdae').get('/api/auth/me')).status, 401);
});

test('시스템/감사 로그 권한', async () => {
  assert.equal((await as('dev').get('/api/system/stats')).status, 200);
  assert.equal((await as('hq').get('/api/system/stats')).status, 403);
  const logs = await as('hq').get('/api/audit-logs');
  assert.equal(logs.status, 200);
  assert.ok(logs.body.some((l) => l.action === 'menu.item_update'));
});
