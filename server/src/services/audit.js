import { query } from '../db/pool.js';

export async function audit(req, action, { entity, entityId, orgId, detail } = {}) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, org_id, action, entity, entity_id, detail, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user?.id ?? null, orgId ?? req.user?.orgId ?? null, action, entity ?? null,
        entityId != null ? String(entityId) : null, detail ? JSON.stringify(detail) : null, req.ip],
    );
  } catch (err) {
    console.error('audit log failed', err.message);
  }
}
