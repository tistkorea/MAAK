// 데모 데이터: 조직 계층, 역할별 계정, 스테이션, 마스터 메뉴·레시피, 최근 7일 주문·조리 이력, 직원 호출/고객 요청
// 사용: npm run seed            (비어 있을 때만)
//       npm run seed -- --reset (전체 초기화 후 재생성)
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { pool, query } from './pool.js';
import { migrate } from './migrate.js';
import { createOrder, itemAction } from '../services/orderService.js';

const STATIONS = [
  { name: '그릴', type: 'grill', color: '#ef4444', sort: 1 },
  { name: '국·찌개', type: 'soup', color: '#f59e0b', sort: 2 },
  { name: '튀김·전', type: 'fry', color: '#eab308', sort: 3 },
  { name: '찬·산채', type: 'cold', color: '#22c55e', sort: 4, isDefault: true },
  { name: '음료', type: 'drink', color: '#06b6d4', sort: 5 },
  { name: '패스(서빙)', type: 'expo', color: '#8b5cf6', sort: 9, isExpo: true },
];

const MENU = [
  ['식사', [
    ['M001', '산채비빔밥', ['산채비빔'], 11000, 'cold', 8, ['돌솥 예열 230℃ 3분', '산채 6종 계량(각 25g) 후 방사형 배치', '계란 프라이 반숙 올리기', '고추장·참기름 별도 제공'], ['계란', '대두']],
    ['M002', '곤드레나물밥', ['곤드레밥'], 12000, 'cold', 10, ['곤드레밥 1공기(220g) 담기', '양념간장 30ml 곁들임', '들기름 5ml 마무리'], ['대두']],
    ['M003', '된장찌개', ['된장'], 9000, 'soup', 9, ['육수 350ml 끓이기', '된장 40g 풀기', '두부·애호박·버섯 투입 후 4분', '청양고추·대파 토핑'], ['대두']],
    ['M004', '김치찌개', ['김치'], 9500, 'soup', 10, ['묵은지 120g·돼지고기 60g 볶기', '육수 350ml 넣고 6분', '두부 투입 후 2분'], ['대두', '돼지고기']],
  ]],
  ['구이·볶음', [
    ['M101', '제육볶음', ['제육'], 13000, 'grill', 12, ['양념 돼지고기 200g 센불 볶음', '양파·대파 투입 후 1분', '참깨 토핑, 상추 곁들임'], ['돼지고기', '대두', '밀']],
    ['M102', '더덕구이', ['더덕'], 15000, 'grill', 12, ['손질 더덕 150g 유장 처리', '고추장 양념 바르기', '석쇠 앞뒤 2분씩 굽기'], ['대두', '밀']],
    ['M103', '황태구이', ['황태'], 14000, 'grill', 11, ['황태포 불리기 확인', '양념 발라 굽기 앞뒤 3분'], ['대두', '밀']],
  ]],
  ['전·튀김', [
    ['M201', '감자전', [], 12000, 'fry', 9, ['감자 반죽 180g', '팬 기름 15ml 중불', '앞뒤 3분 노릇하게'], []],
    ['M202', '메밀전병', ['전병'], 11000, 'fry', 8, ['메밀 반죽 얇게 부치기', '김치소 60g 말기', '3등분 컷팅'], ['메밀', '밀']],
  ]],
  ['찬·안주', [
    ['M301', '도토리묵무침', ['묵무침'], 13000, 'cold', 6, ['묵 200g 썰기', '채소·양념장 버무리기'], ['대두']],
    ['M302', '산채모둠', ['나물모둠'], 9000, 'cold', 5, ['계절 산채 5종 각 30g 플레이팅'], []],
  ]],
  ['면·만두', [
    ['N001', '들깨손면', ['들깨면'], 10000, 'soup', 6, ['들깨 육수 400ml 끓이기', '손면 180g 삶기 3분 30초', '찬물 헹굼 후 육수에 담아 30초', '들깨가루·김가루 토핑'], ['밀', '들깨']],
    ['N002', '메밀만두', ['만두'], 8000, 'fry', 7, ['메밀만두 6개 찜기 5분', '초간장 곁들임'], ['메밀', '밀', '돼지고기']],
    ['N003', '평양냉면', ['냉면'], 13000, 'cold', 5, ['육수 450ml 냉각 확인', '면 160g 삶기 50초', '편육·배·계란 고명'], ['메밀', '밀', '계란']],
  ]],
  ['음료·주류', [
    ['D001', '식혜', [], 3000, 'drink', 2, ['냉장 식혜 200ml 서빙'], []],
    ['D002', '막걸리', ['막걸리750'], 6000, 'drink', 1, ['냉장 막걸리 + 사발'], []],
    ['D003', '오미자차', ['오미자'], 4000, 'drink', 3, ['오미자청 30ml + 냉수 170ml, 얼음'], []],
  ]],
];

async function insertOrg(type, parentId, name, code, extra = {}) {
  const { rows } = await query(
    'INSERT INTO organizations (type, parent_id, name, code, address, phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [type, parentId, name, code, extra.address || null, extra.phone || null],
  );
  return rows[0];
}

async function insertUser(orgId, role, loginId, password, name) {
  const { rows } = await query(
    'INSERT INTO users (org_id, role, login_id, password_hash, name) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [orgId, role, loginId, await bcrypt.hash(password, 10), name],
  );
  return rows[0].id;
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 대량 INSERT 헬퍼
async function insertMany(table, cols, rows, returning = '') {
  if (!rows.length) return [];
  const params = [];
  const values = rows.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(',')})`);
  const res = await query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')} ${returning}`, params);
  return res.rows;
}

const CANCEL_REASONS = ['고객 변심', '오주문', '재료 소진', '대기시간 지연'];
const REQUEST_CATEGORIES = [['staff_call', '직원 호출'], ['customer_request', '물'], ['customer_request', '앞접시'],
  ['customer_request', '추가 반찬'], ['customer_request', '재촉'], ['customer_request', '수저'], ['staff_call', '계산']];

// 최근 N일 주문 이력: 인원·유입경로·수량 단위 진행·작업자·제공(픽업)·부분취소·직원호출/고객요청
async function seedOrders(store, stations, menu, { cooks, hall }, days = 7) {
  const byType = new Map(stations.filter((s) => !s.is_expo).map((s) => [s.type, s]));
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const midnight = new Date(`${today}T00:00:00+09:00`).getTime();
  const MIN = 60000;
  const at = (t) => new Date(t);

  for (let d = days; d >= 1; d--) {
    const dayStart = midnight - d * 86400000;
    const weekend = [0, 6].includes(new Date(dayStart + 12 * 3600000).getDay());
    const count = Math.round(rand(35, 60) * (weekend ? 1.3 : 1));
    for (let n = 1; n <= count; n++) {
      // 점심(11:30~13:30)·저녁(18~20시) 피크
      const hour = Math.random() < 0.45 ? rand(11.5, 13.5) : Math.random() < 0.7 ? rand(18, 20.5) : rand(11, 21);
      const created = dayStart + hour * 3600000;
      const rushHour = (hour > 12 && hour < 13) || (hour > 18.5 && hour < 19.5);
      const r = Math.random();
      const source = r < 0.5 ? 'pos' : r < 0.88 ? 'table_order' : 'printer';
      const orderType = Math.random() < 0.82 ? 'dine_in' : pick(['takeout', 'delivery']);
      const guests = orderType === 'dine_in' ? pick([1, 2, 2, 2, 3, 3, 4, 4, 4, 5, 6]) : null;
      const lineCount = Math.min(5, Math.max(1, Math.round((guests || 1.5) * rand(0.5, 1.0))));
      const cook = pick(cooks);
      const server = pick(hall);
      const orderCancelled = Math.random() < 0.02;

      const lines = Array.from({ length: lineCount }, () => {
        const m = pick(menu);
        const qty = Math.random() < 0.75 ? 1 : 2;
        const started = created + rand(0.1, rushHour ? 1.0 : 0.4) * MIN;
        // 조리 숙련도: 작업자별 편차 + 피크 지연
        const factor = rand(0.72, rushHour ? 1.2 : 0.98) * cook.speed;
        const done = started + m.target_minutes * factor * MIN;
        const served = done + rand(0.2, rushHour ? 3.5 : 1.5) * MIN;
        const partialCancel = qty === 2 && Math.random() < 0.06;
        return { m, qty, started, done, served, partialCancel, partialAt: qty === 2 && Math.random() < 0.5 };
      });
      const target = Math.max(...lines.map((l) => l.m.target_minutes));
      const ready = Math.max(...lines.map((l) => l.done));
      const servedAll = Math.max(...lines.map((l) => l.served));
      const cancelAt = created + rand(0.5, 3) * MIN;

      const [o] = await insertMany('orders',
        ['store_id', 'display_no', 'source', 'table_no', 'guest_count', 'order_type', 'status', 'target_minutes',
          'created_at', 'started_at', 'ready_at', 'served_at', 'cancelled_at'],
        [[store.id, String(n).padStart(3, '0'), source, orderType === 'dine_in' ? String(Math.ceil(rand(0, 16))) : null,
          guests, orderType, orderCancelled ? 'cancelled' : 'served', target, at(created),
          orderCancelled ? null : at(Math.min(...lines.map((l) => l.started))),
          orderCancelled ? null : at(ready), orderCancelled ? null : at(servedAll),
          orderCancelled ? at(cancelAt) : null]], 'RETURNING id');

      const itemRows = await insertMany('order_items',
        ['order_id', 'menu_item_id', 'station_id', 'name', 'qty', 'status', 'target_minutes', 'min_minutes',
          'started_at', 'done_at', 'served_at', 'done_by', 'done_qty', 'cancel_qty', 'cancel_reason'],
        lines.map((l) => {
          const cancelQty = orderCancelled ? l.qty : l.partialCancel ? 1 : 0;
          return [o.id, l.m.id, (byType.get(l.m.station_type) || byType.get('cold')).id, l.m.name, l.qty,
            orderCancelled ? 'cancelled' : 'served', l.m.target_minutes, l.m.min_minutes,
            orderCancelled ? null : at(l.started), orderCancelled ? null : at(l.done),
            orderCancelled ? null : at(l.served), orderCancelled ? null : cook.id,
            orderCancelled ? 0 : l.qty - cancelQty, cancelQty,
            cancelQty ? pick(CANCEL_REASONS) : null];
        }), 'RETURNING id');

      const ev = [];
      const push = (itemId, event, t, qty, userId = null, reason = null) =>
        ev.push([store.id, o.id, itemId, event, qty, userId, reason, at(t)]);
      lines.forEach((l, i) => {
        const id = itemRows[i].id;
        push(id, 'received', created, l.qty);
        if (orderCancelled) { push(id, 'cancelled', cancelAt, l.qty, null, pick(CANCEL_REASONS)); return; }
        push(id, 'cooking', l.started, l.qty, cook.id);
        if (l.partialCancel) push(id, 'partial_cancel', l.started + (Math.random() < 0.5 ? -0.05 : 0.5) * MIN, 1, cook.id, pick(CANCEL_REASONS));
        const liveQty = l.qty - (l.partialCancel ? 1 : 0);
        if (liveQty === 2 && l.partialAt) {
          push(id, 'partial', l.started + (l.done - l.started) * 0.7, 1, cook.id);
          push(id, 'ready', l.done, 1, cook.id);
        } else {
          push(id, 'ready', l.done, liveQty, cook.id);
        }
        push(id, 'served', l.served, liveQty, server.id);
      });
      await insertMany('order_item_events',
        ['store_id', 'order_id', 'item_id', 'event', 'qty', 'user_id', 'reason', 'created_at'], ev);
    }

    // 직원 호출 · 고객 요청
    const reqs = [];
    for (let k = 0, m = Math.round(rand(12, 25) * (weekend ? 1.3 : 1)); k < m; k++) {
      const hour = Math.random() < 0.6 ? rand(12, 13.5) : rand(18, 21);
      const t = dayStart + hour * 3600000;
      const [type, category] = pick(REQUEST_CATEGORIES);
      const ack = t + rand(0.2, hour > 18.5 && hour < 19.5 ? 3 : 1.5) * MIN;
      reqs.push([store.id, String(Math.ceil(rand(0, 16))), type, category, Math.random() < 0.6 ? 'table_order' : 'staff',
        'done', pick(hall).id, at(t), at(ack), at(ack + rand(0.3, 2) * MIN)]);
    }
    await insertMany('service_requests',
      ['store_id', 'table_no', 'type', 'category', 'source', 'status', 'handled_by', 'created_at', 'ack_at', 'done_at'], reqs);
  }
}

export async function seed({ reset = false, log = console.log } = {}) {
  if (reset) {
    await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }
  await migrate({ log });
  const exists = await query("SELECT 1 FROM users WHERE login_id = 'dev'");
  if (exists.rows[0]) {
    log('seed: 이미 데이터가 있습니다 (--reset 으로 초기화)');
    return;
  }

  const platform = await insertOrg('platform', null, 'MPS 개발팀', 'MPS');
  const hq = await insertOrg('hq', platform.id, '백두대간한상 가맹본부', 'BDH', { phone: '02-000-0000' });
  const seoul = await insertOrg('branch', hq.id, '서울지사', 'BDH-SEL');
  const gangwon = await insertOrg('branch', hq.id, '강원지사', 'BDH-GW');
  const gangnam = await insertOrg('store', seoul.id, '강남점', 'BDH-SEL-001', { address: '서울 강남구 테헤란로 1' });
  const mapo = await insertOrg('store', seoul.id, '마포점', 'BDH-SEL-002', { address: '서울 마포구 월드컵로 1' });
  const chuncheon = await insertOrg('store', gangwon.id, '춘천점', 'BDH-GW-001', { address: '강원 춘천시 중앙로 1' });

  await insertUser(platform.id, 'developer', 'dev', 'dev1234', '개발팀 관리자');
  await insertUser(hq.id, 'hq_admin', 'hq', 'hq1234', '본부 운영팀장');
  await insertUser(seoul.id, 'branch_admin', 'branch', 'branch1234', '서울지사장');
  await insertUser(gangwon.id, 'branch_admin', 'branch2', 'branch1234', '강원지사장');
  await insertUser(gangnam.id, 'store_owner', 'owner', 'owner1234', '강남점 점주');
  const gnManager = await insertUser(gangnam.id, 'manager', 'manager', 'manager1234', '강남점 매니저');
  // 작업자: speed < 1 이면 표준보다 빠름 (작업자별 분석 데모)
  const staff = {
    [gangnam.id]: {
      cooks: [
        { id: await insertUser(gangnam.id, 'staff', 'staff', 'staff1234', '김주방'), speed: 0.92 },
        { id: await insertUser(gangnam.id, 'staff', 'park', 'staff1234', '박주방'), speed: 1.08 },
      ],
      hall: [{ id: await insertUser(gangnam.id, 'staff', 'server', 'staff1234', '이홀') }, { id: gnManager }],
    },
    [mapo.id]: {
      cooks: [{ id: await insertUser(mapo.id, 'staff', 'mapo1', 'staff1234', '정주방'), speed: 1.0 }],
      hall: [{ id: await insertUser(mapo.id, 'staff', 'mapo2', 'staff1234', '한홀') }],
    },
    [chuncheon.id]: {
      cooks: [{ id: await insertUser(chuncheon.id, 'staff', 'cc1', 'staff1234', '최주방'), speed: 0.97 }],
      hall: [{ id: await insertUser(chuncheon.id, 'staff', 'cc2', 'staff1234', '윤홀') }],
    },
  };
  await insertUser(mapo.id, 'store_owner', 'owner2', 'owner1234', '마포점 점주');
  await insertUser(chuncheon.id, 'store_owner', 'owner3', 'owner1234', '춘천점 점주');

  const menuRows = [];
  let ci = 0;
  for (const [catName, items] of MENU) {
    const { rows: [cat] } = await query(
      'INSERT INTO menu_categories (hq_id, name, sort_order) VALUES ($1,$2,$3) RETURNING id', [hq.id, catName, ci++]);
    let si = 0;
    for (const [code, name, aliases, price, stationType, target, recipe, allergens] of items) {
      const { rows: [m] } = await query(
        `INSERT INTO menu_items (hq_id, category_id, code, name, aliases, price, station_type, target_minutes, min_minutes, recipe, allergens, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [hq.id, cat.id, code, name, aliases, price, stationType, target, target > 2 ? Math.round(target * 0.65) : null,
          JSON.stringify(recipe), allergens, si++]);
      menuRows.push(m);
    }
  }

  for (const store of [gangnam, mapo, chuncheon]) {
    const stations = [];
    for (const s of STATIONS) {
      const { rows: [st] } = await query(
        `INSERT INTO stations (store_id, name, type, color, is_expo, is_default, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [store.id, s.name, s.type, s.color, Boolean(s.isExpo), Boolean(s.isDefault), s.sort]);
      stations.push(st);
    }
    await seedOrders(store, stations, menuRows, staff[store.id]);
  }

  // 강남점 진행 중 주문 (MENU PORTAL 테이블 화면 데모)
  const cookA = staff[gangnam.id].cooks[0].id;
  const cookB = staff[gangnam.id].cooks[1].id;
  const live = [
    { ago: 6, o: { tableNo: '1', guestCount: 4, source: 'table_order', items: [{ name: '평양냉면', qty: 2 }, { name: '제육볶음', qty: 1 }, { name: '메밀만두', qty: 1 }] },
      acts: [[0, 'ready', cookA], [1, 'cooking', cookB]] },
    { ago: 4, o: { tableNo: '2', guestCount: 2, items: [{ name: '산채비빔밥', qty: 1 }, { name: '제육볶음', qty: 1 }, { name: '메밀만두', qty: 1 }] },
      acts: [[1, 'ready', cookB]] },
    { ago: 8, o: { tableNo: '3', guestCount: 4, source: 'table_order', items: [{ name: '들깨손면', qty: 2 }, { name: '더덕구이', qty: 1 }, { name: '메밀만두', qty: 1 }] },
      acts: [[0, 'cooking', cookA], [0, 'progress', cookA, { doneQty: 1 }], [1, 'cooking', cookB], [2, 'ready', cookB]] },
    { ago: 14, o: { tableNo: '4', guestCount: 2, items: [{ name: '평양냉면', qty: 2 }, { name: '메밀만두', qty: 1 }, { name: '식혜', qty: 1 }] },
      acts: [[0, 'cooking', cookA], [0, 'ready', cookA], [0, 'served', gnManager], [1, 'cooking', cookB], [1, 'ready', cookB], [1, 'served', gnManager]] },
    { ago: 3, o: { tableNo: '5', guestCount: 3, rush: true, memo: '아이 동반, 앞접시 2개', items: [{ name: '김치찌개', qty: 2, options: '덜맵게' }, { name: '감자전', qty: 1 }] },
      acts: [[0, 'cooking', cookA], [0, 'cancel', gnManager, { qty: 1, reason: '고객 변심' }], [1, 'ready', cookB]] },
    { ago: 7, o: { tableNo: '6', guestCount: 4, source: 'table_order', items: [{ name: '더덕구이', qty: 2 }, { name: '들깨손면', qty: 2 }, { name: '곤드레나물밥', qty: 1 }] },
      acts: [[0, 'cooking', cookB], [1, 'cooking', cookA]] },
    { ago: 1, o: { tableNo: '7', guestCount: 2, items: [{ name: '평양냉면', qty: 1 }, { name: '된장찌개', qty: 1 }, { name: '막걸리', qty: 1 }] }, acts: [] },
    { ago: 2, o: { orderType: 'takeout', items: [{ name: '감자전', qty: 1 }, { name: '메밀전병', qty: 1 }] }, acts: [[0, 'cooking', cookB]] },
  ];
  for (const { ago, o, acts } of live) {
    const { order } = await createOrder(gangnam.id, { source: 'pos', ...o });
    await query(`UPDATE orders SET created_at = now() - make_interval(mins => $2) WHERE id = $1`, [order.id, ago]);
    await query(`UPDATE order_item_events SET created_at = now() - make_interval(mins => $2) WHERE order_id = $1`, [order.id, ago]);
    for (const [idx, action, userId, opts] of acts) await itemAction(order.items[idx].id, action, userId, opts);
    // 데모용: 방금 처리한 조리 시각을 주문 시각과 현재 사이로 분산
    await query(
      `UPDATE order_items SET started_at = started_at - make_interval(secs => $2 * 48),
              done_at = done_at - make_interval(secs => $2 * 15), served_at = served_at - make_interval(secs => $2 * 5)
        WHERE order_id = $1`, [order.id, ago]);
    await query(
      `UPDATE order_item_events SET created_at = created_at - make_interval(secs => $2 * CASE event
          WHEN 'cooking' THEN 48 WHEN 'partial' THEN 25 WHEN 'ready' THEN 15 WHEN 'served' THEN 5 WHEN 'partial_cancel' THEN 30 ELSE 0 END)
        WHERE order_id = $1 AND event <> 'received'`, [order.id, ago]);
    await query(`UPDATE orders SET started_at = started_at - make_interval(secs => $2 * 48),
                   ready_at = ready_at - make_interval(secs => $2 * 15), served_at = served_at - make_interval(secs => $2 * 5)
                  WHERE id = $1`, [order.id, ago]);
  }
  await query(
    `INSERT INTO service_requests (store_id, table_no, type, category, message, source, created_at) VALUES
      ($1, '3', 'customer_request', '물', '물 2병 부탁드려요', 'table_order', now() - interval '2 minutes'),
      ($1, '6', 'staff_call', '직원 호출', NULL, 'table_order', now() - interval '40 seconds')`,
    [gangnam.id]);

  await query(
    `INSERT INTO notices (org_id, title, body, pinned) VALUES
      ($1, '10월 신메뉴 「더덕구이」 표준 레시피 적용', '더덕구이 표준 조리시간 12분, 석쇠 앞뒤 2분씩. KDS 레시피 화면을 확인하세요.', true),
      ($2, '서울지사 점검 안내', '다음 주 화요일 위생·KDS 운영 점검이 있습니다.', false)`,
    [hq.id, seoul.id]);

  log('seed: 완료');
  log('  개발팀 dev/dev1234 · 본부 hq/hq1234 · 지점 branch/branch1234');
  log('  점주 owner/owner1234 · 매니저 manager/manager1234 · 스텝 staff/staff1234');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed({ reset: process.argv.includes('--reset') })
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
