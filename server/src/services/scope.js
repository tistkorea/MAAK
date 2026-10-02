import { query } from '../db/pool.js';
import { forbidden, notFound } from '../errors.js';

// 사용자는 자신의 조직과 그 하위 조직에만 접근할 수 있다.
export function inScope(user, org) {
  return Boolean(org && org.path.startsWith(user.orgPath));
}

export async function getOrg(id) {
  const { rows } = await query('SELECT * FROM organizations WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function assertOrgAccess(user, orgId) {
  const org = await getOrg(orgId);
  if (!org) throw notFound('조직을 찾을 수 없습니다');
  if (!inScope(user, org)) throw forbidden('접근 범위를 벗어난 조직입니다');
  return org;
}

export async function assertStoreAccess(user, storeId) {
  const org = await assertOrgAccess(user, storeId);
  if (org.type !== 'store') throw notFound('매장이 아닙니다');
  return org;
}

// 매장(또는 지점)의 상위 가맹본부(브랜드)
export async function hqOf(org) {
  if (org.type === 'hq') return org;
  const { rows } = await query(
    `SELECT * FROM organizations WHERE type = 'hq' AND $1 LIKE path || '%' ORDER BY length(path) DESC LIMIT 1`,
    [org.path],
  );
  return rows[0] || null;
}

export async function storeIdsUnder(org) {
  const { rows } = await query(
    `SELECT id FROM organizations WHERE type = 'store' AND path LIKE $1 || '%'`,
    [org.path],
  );
  return rows.map((r) => r.id);
}
