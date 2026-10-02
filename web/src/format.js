export const ORDER_TYPE = { dine_in: '매장', takeout: '포장', delivery: '배달' };
export const ORDER_STATUS = { received: '접수', cooking: '조리중', ready: '조리완료', served: '서빙완료', cancelled: '취소' };
export const ITEM_STATUS = { pending: '대기', cooking: '조리중', done: '완료', cancelled: '취소' };
export const ORG_TYPE = { platform: '개발팀', hq: '가맹본부', branch: '가맹지점', store: '가맹점' };
export const ROLE_LABEL = {
  developer: '개발팀', hq_admin: '가맹본부', branch_admin: '가맹지점',
  store_owner: '가맹점(점주)', manager: '매니저', staff: '스텝',
};
export const ROLE_ORG = {
  developer: 'platform', hq_admin: 'hq', branch_admin: 'branch',
  store_owner: 'store', manager: 'store', staff: 'store',
};
export const ROLE_LEVEL = { developer: 100, hq_admin: 80, branch_admin: 60, store_owner: 40, manager: 30, staff: 10 };
export const STATION_TYPES = [
  ['grill', '그릴·볶음'], ['soup', '국·찌개'], ['fry', '튀김·전'], ['cold', '찬·샐러드'],
  ['main', '메인'], ['noodle', '면'], ['rice', '밥'], ['dessert', '디저트·베이커리'], ['drink', '음료·주류'], ['expo', '패스(서빙)'],
];

export function mmss(sec) {
  if (sec == null || Number.isNaN(sec)) return '-';
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function elapsedSec(from, now = Date.now()) {
  return (now - new Date(from).getTime()) / 1000;
}

export const won = (n) => (n == null ? '-' : `${Number(n).toLocaleString('ko-KR')}원`);
export const dt = (v) => (v ? new Date(v).toLocaleString('ko-KR', { hour12: false }) : '-');
export const time = (v) => (v ? new Date(v).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '-');
export const today = () => new Date().toLocaleDateString('sv-SE');
export const daysAgo = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE');

// 경과시간/표준시간 비율에 따른 단계
export function urgency(elapsed, targetMin) {
  const r = elapsed / (targetMin * 60);
  if (r >= 1) return 'late';
  if (r >= 0.7) return 'warn';
  return 'ok';
}
