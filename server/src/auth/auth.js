import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { HttpError, forbidden } from '../errors.js';
import { hasPermission } from './rbac.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

// 토큰 검증 후 DB에서 최신 사용자 상태(비활성화 등)를 다시 읽는다
export async function userFromToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
  const { rows } = await query(
    `SELECT u.id, u.login_id, u.name, u.role, u.org_id, u.active,
            o.path AS org_path, o.type AS org_type, o.name AS org_name, o.status AS org_status
       FROM users u JOIN organizations o ON o.id = u.org_id
      WHERE u.id = $1`,
    [payload.sub],
  );
  const u = rows[0];
  if (!u || !u.active) return null;
  // 운영 중지/폐점 조직 소속은 즉시 차단 (개발팀 제외)
  if (u.org_status !== 'active' && u.role !== 'developer') return null;
  return {
    id: u.id, loginId: u.login_id, name: u.name, role: u.role,
    orgId: u.org_id, orgPath: u.org_path, orgType: u.org_type, orgName: u.org_name,
  };
}

export async function requireAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = token && (await userFromToken(token));
  if (!user) return next(new HttpError(401, '로그인이 필요합니다'));
  req.user = user;
  next();
}

export const requirePerm = (perm) => (req, _res, next) => {
  if (!hasPermission(req.user.role, perm)) return next(forbidden());
  next();
};

// ---- 디바이스(POS/프린터 에이전트) API 키 ----
export function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function generateDeviceKey() {
  return `mps_${crypto.randomBytes(24).toString('base64url')}`;
}

export async function requireDevice(req, _res, next) {
  const key = req.get('x-device-key');
  if (!key) return next(new HttpError(401, 'X-Device-Key 헤더가 필요합니다'));
  const { rows } = await query(
    `UPDATE devices d SET last_seen_at = now()
       FROM organizations o
      WHERE d.key_hash = $1 AND d.active AND o.id = d.store_id AND o.status = 'active'
      RETURNING d.id, d.store_id, d.name, d.type`,
    [hashKey(key)],
  );
  if (!rows[0]) return next(new HttpError(401, '유효하지 않은 디바이스 키입니다'));
  req.device = rows[0];
  next();
}
