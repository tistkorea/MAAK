import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { NAV } from '../components/Layout.jsx';
import { Kpi } from '../components/ui.jsx';
import { ORG_TYPE, ROLE_LABEL, dt, mmss } from '../format.js';

const ROLE_GUIDE = {
  developer: '플랫폼 전체(가맹본부·지점·매장)와 시스템 상태, 감사 로그를 관리합니다.',
  hq_admin: '브랜드 마스터 메뉴·표준 레시피·표준 조리시간을 관리하고 전 매장 운영 품질을 분석합니다.',
  branch_admin: '관할 가맹점을 개설·관리하고 조리 품질 지표를 점검합니다.',
  store_owner: '매장 스테이션·메뉴 운영·직원·POS 연결을 관리하고 매장 품질 지표를 확인합니다.',
  manager: '영업 중 주방 흐름(스테이션·품절·긴급/취소)을 통제하고 직원을 관리합니다.',
  staff: 'KDS 화면에서 주문을 조리·완료하고 패스에서 서빙을 처리합니다.',
};

export default function Home() {
  const { user, can, storeId, store } = useAuth();
  const { data: notices } = useApi('/notices');
  const { data: summary } = useApi(can('analytics:view') ? `/analytics/summary?orgId=${user.orgId}` : null);
  const tiles = NAV.flatMap((g) => g.items).filter((i) => (!i.perm || can(i.perm)) && (!i.store || storeId));

  return (
    <div>
      <h1>안녕하세요, {user.name}님</h1>
      <p className="muted">{ROLE_LABEL[user.role]} · {ORG_TYPE[user.orgType]} {user.orgName} — {ROLE_GUIDE[user.role]}</p>

      {summary && (
        <>
          <h2>오늘의 주방 품질 <span className="small muted">({summary.org.name}{summary.storeCount > 1 ? ` · ${summary.storeCount}개 매장` : ''})</span></h2>
          <div className="kpis">
            <Kpi label="주문" value={summary.kpi.orders} />
            <Kpi label="평균 조리완료 시간" value={mmss(summary.kpi.avg_ticket_sec)} hint="주문 접수 → 조리 완료" />
            <Kpi label="평균 패스 대기" value={mmss(summary.kpi.avg_pass_sec)} hint="조리 완료 → 서빙" />
            <Kpi label="표준시간 초과율" value={summary.kpi.late_rate == null ? '-' : `${summary.kpi.late_rate}%`}
              tone={summary.kpi.late_rate > 20 ? 'late' : summary.kpi.late_rate > 10 ? 'warn' : 'ok'} />
          </div>
        </>
      )}

      <h2>바로가기 {store && <span className="small muted">· 현재 매장 {store.name}</span>}</h2>
      <div className="tiles">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="card tile">
            <div className="t">{t.label}</div>
          </Link>
        ))}
      </div>

      <h2>공지사항</h2>
      <div className="card">
        {!notices?.length && <div className="muted">공지가 없습니다.</div>}
        {notices?.slice(0, 5).map((n) => (
          <div key={n.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="row">
              {n.pinned && <span className="badge warn">고정</span>}
              <strong>{n.title}</strong>
              <span className="spacer" />
              <span className="small muted">{n.org_name} · {dt(n.created_at)}</span>
            </div>
            <div className="small muted" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{n.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
