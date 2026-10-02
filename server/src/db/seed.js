// 데모 데이터: 조직 계층, 역할별 계정, 스테이션, 마스터 메뉴·레시피, 최근 7일 주문 이력
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
  await query(
    'INSERT INTO users (org_id, role, login_id, password_hash, name) VALUES ($1,$2,$3,$4,$5)',
    [orgId, role, loginId, await bcrypt.hash(password, 10), name],
  );
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function seedOrders(store, stations, menu, days = 7) {
  const byType = new Map(stations.filter((s) => !s.is_expo).map((s) => [s.type, s]));
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const midnight = new Date(`${today}T00:00:00+09:00`).getTime();
  const MIN = 60000;

  for (let d = days; d >= 1; d--) {
    const dayStart = midnight - d * 86400000;
    const count = Math.round(rand(35, 70));
    for (let n = 1; n <= count; n++) {
      // 점심(11:30~13:30)·저녁(18~20시) 피크
      const hour = Math.random() < 0.45 ? rand(11.5, 13.5) : Math.random() < 0.7 ? rand(18, 20.5) : rand(11, 21);
      const created = dayStart + hour * 3600000;
      const rushHour = (hour > 12 && hour < 13) || (hour > 18.5 && hour < 19.5);
      const items = Array.from({ length: 1 + Math.floor(rand(0, 3.5)) }, () => pick(menu));
      let ready = created;
      const lines = items.map((m) => {
        const started = created + rand(0.1, rushHour ? 1.2 : 0.6) * MIN;
        const done = started + m.target_minutes * rand(0.55, rushHour ? 1.15 : 0.95) * MIN;
        ready = Math.max(ready, done);
        return { m, started, done };
      });
      const served = ready + rand(0.3, rushHour ? 4 : 2) * MIN;
      const cancelled = Math.random() < 0.02;
      const target = Math.max(...items.map((m) => m.target_minutes));
      const { rows: [o] } = await query(
        `INSERT INTO orders (store_id, display_no, source, table_no, order_type, status, target_minutes,
                             created_at, started_at, ready_at, served_at, cancelled_at)
         VALUES ($1,$2,'pos',$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [store.id, String(n).padStart(3, '0'), String(Math.ceil(rand(0, 20))),
          Math.random() < 0.8 ? 'dine_in' : pick(['takeout', 'delivery']),
          cancelled ? 'cancelled' : 'served', target, new Date(created),
          new Date(Math.min(...lines.map((l) => l.started))),
          cancelled ? null : new Date(ready), cancelled ? null : new Date(served),
          cancelled ? new Date(created + 2 * MIN) : null],
      );
      for (const l of lines) {
        await query(
          `INSERT INTO order_items (order_id, menu_item_id, station_id, name, qty, status, target_minutes, started_at, done_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [o.id, l.m.id, (byType.get(l.m.station_type) || byType.get('cold')).id, l.m.name,
            Math.random() < 0.8 ? 1 : 2, cancelled ? 'cancelled' : 'done', l.m.target_minutes,
            new Date(l.started), cancelled ? null : new Date(l.done)],
        );
      }
    }
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
  await insertUser(gangnam.id, 'manager', 'manager', 'manager1234', '강남점 매니저');
  await insertUser(gangnam.id, 'staff', 'staff', 'staff1234', '강남점 주방스텝');
  await insertUser(gangnam.id, 'staff', 'server', 'staff1234', '강남점 홀스텝');
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
        `INSERT INTO menu_items (hq_id, category_id, code, name, aliases, price, station_type, target_minutes, recipe, allergens, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [hq.id, cat.id, code, name, aliases, price, stationType, target, JSON.stringify(recipe), allergens, si++]);
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
    await seedOrders(store, stations, menuRows);
  }

  // 강남점 진행 중 주문 (KDS 데모용)
  const live = [
    { tableNo: '4', items: [{ name: '산채비빔밥', qty: 2 }, { name: '된장찌개', qty: 1 }, { name: '식혜', qty: 2 }] },
    { tableNo: '9', rush: true, memo: '아이 동반, 앞접시 2개', items: [{ name: '제육볶음', qty: 1, options: '덜맵게' }, { name: '감자전', qty: 1 }] },
    { orderType: 'takeout', items: [{ name: '더덕구이', qty: 1 }, { name: '곤드레나물밥', qty: 1 }] },
  ];
  for (const [i, o] of live.entries()) {
    const { order } = await createOrder(gangnam.id, { ...o, source: 'pos' });
    await query(`UPDATE orders SET created_at = now() - make_interval(mins => $2) WHERE id = $1`, [order.id, 9 - i * 4]);
    if (i === 0) await itemAction(order.items[0].id, 'start', null);
  }

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
