// 역할 기반 권한(RBAC)
// 개발팀 > 가맹본부 > 가맹지점(지사) > 가맹점(점주) > 매니저 > 스텝

export const ROLES = {
  developer:    { level: 100, label: '개발팀',   orgType: 'platform' },
  hq_admin:     { level: 80,  label: '가맹본부', orgType: 'hq' },
  branch_admin: { level: 60,  label: '가맹지점', orgType: 'branch' },
  store_owner:  { level: 40,  label: '가맹점',   orgType: 'store' },
  manager:      { level: 30,  label: '매니저',   orgType: 'store' },
  staff:        { level: 10,  label: '스텝',     orgType: 'store' },
};

export const PERMISSIONS = {
  'system:manage':  '시스템 운영/모니터링',
  'org:view':       '조직 조회',
  'org:manage':     '조직(지점/매장) 생성·수정',
  'user:manage':    '사용자 관리',
  'menu:view':      '메뉴·레시피 조회',
  'menu:master':    '마스터 메뉴·레시피 관리',
  'menu:store':     '매장 메뉴 운영(품절/라우팅)',
  'station:manage': '주방 스테이션 관리',
  'kds:operate':    'KDS 조리/서빙 처리',
  'order:manage':   '주문 취소·긴급 처리',
  'order:create':   '수동 주문 등록 / POS 테스트',
  'device:manage':  'POS·프린터 에이전트 관리',
  'analytics:view': '운영 분석',
  'notice:publish': '공지 발행',
  'audit:view':     '감사 로그 조회',
};

const ALL = Object.keys(PERMISSIONS);

const ROLE_PERMISSIONS = {
  developer: ALL,
  hq_admin: ALL.filter((p) => p !== 'system:manage'),
  branch_admin: ['org:view', 'org:manage', 'user:manage', 'menu:view', 'menu:store', 'station:manage',
    'kds:operate', 'order:manage', 'analytics:view', 'notice:publish'],
  store_owner: ['org:view', 'user:manage', 'menu:view', 'menu:store', 'station:manage', 'kds:operate',
    'order:manage', 'order:create', 'device:manage', 'analytics:view', 'notice:publish'],
  manager: ['user:manage', 'menu:view', 'menu:store', 'station:manage', 'kds:operate', 'order:manage',
    'order:create', 'device:manage', 'analytics:view'],
  staff: ['menu:view', 'kds:operate'],
};

export function permissionsOf(role) {
  return ROLE_PERMISSIONS[role] || [];
}

export function hasPermission(role, perm) {
  return permissionsOf(role).includes(perm);
}

// 하위 조직 유형 규칙
export const CHILD_ORG_TYPES = {
  platform: ['hq'],
  hq: ['branch', 'store'],
  branch: ['store'],
  store: [],
};

// actor 가 targetRole 사용자를 만들/수정할 수 있는가
export function canAssignRole(actorRole, targetRole) {
  const a = ROLES[actorRole];
  const t = ROLES[targetRole];
  if (!a || !t) return false;
  if (actorRole === 'developer') return true;
  return t.level < a.level;
}

export function roleFitsOrg(role, orgType) {
  return ROLES[role]?.orgType === orgType;
}
