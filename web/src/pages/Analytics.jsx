// 운영 품질 분석: 조리완료 시간, 표준시간 초과율, 스테이션·메뉴·시간대·매장별
import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { ErrorBox, Kpi } from '../components/ui.jsx';
import { ORG_TYPE, daysAgo, mmss, today } from '../format.js';

const lateTone = (r) => (r == null ? '' : r > 20 ? 'late' : r > 10 ? 'warn' : 'ok');

export default function Analytics() {
  const { user, can } = useAuth();
  const { data: orgs } = useApi(can('org:view') ? '/orgs' : null);
  const [orgId, setOrgId] = useState(user.orgId);
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(today());
  const { data, error, loading } = useApi(`/analytics/summary?orgId=${orgId}&from=${from}&to=${to}`);
  const selectable = (orgs || []).filter((o) => o.type !== 'platform');
  const maxHour = Math.max(1, ...(data?.hourly || []).map((h) => h.orders));
  const maxQty = Math.max(1, ...(data?.menus || []).map((m) => m.qty));

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>운영 품질 분석</h1>
        <div className="spacer" />
        {selectable.length > 0 && (
          <select className="input" style={{ width: 'auto' }} value={orgId} onChange={(e) => setOrgId(Number(e.target.value))}>
            {user.orgType === 'platform' && <option value={user.orgId}>전체 플랫폼</option>}
            {selectable.map((o) => <option key={o.id} value={o.id}>{ORG_TYPE[o.type]} · {o.name}</option>)}
          </select>
        )}
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} />
        <span>~</span>
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} />
      </div>
      <ErrorBox error={error} />
      {loading && !data && <div className="empty">불러오는 중…</div>}
      {data && (
        <>
          <div className="kpis">
            <Kpi label="주문 수" value={data.kpi.orders.toLocaleString()} hint={`${data.storeCount}개 매장`} />
            <Kpi label="평균 조리완료 시간" value={mmss(data.kpi.avg_ticket_sec)} hint="접수 → 전체 조리 완료" />
            <Kpi label="평균 패스 대기" value={mmss(data.kpi.avg_pass_sec)} hint="조리 완료 → 서빙" />
            <Kpi label="표준시간 초과율" value={data.kpi.late_rate == null ? '-' : `${data.kpi.late_rate}%`} tone={lateTone(data.kpi.late_rate)} />
            <Kpi label="취소" value={data.kpi.cancelled} />
          </div>

          <div className="grid2" style={{ gap: 16, alignItems: 'start' }}>
            <div className="card">
              <h3>시간대별 주문</h3>
              <div className="bars" style={{ marginBottom: 20 }}>
                {Array.from({ length: 24 }, (_, h) => {
                  const row = data.hourly.find((x) => x.hour === h);
                  return (
                    <div key={h} className="bar" style={{ height: `${((row?.orders || 0) / maxHour) * 100}%`, opacity: row ? 1 : 0.15 }}
                      title={`${h}시 · ${row?.orders || 0}건 · 평균 ${mmss(row?.avg_ticket_sec)}`}>
                      {h % 3 === 0 && <span>{h}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="card">
              <h3>주방 파트(스테이션)별</h3>
              <table className="table">
                <thead><tr><th>스테이션</th><th>수량</th><th>평균 조리</th><th>완료까지</th><th>초과율</th></tr></thead>
                <tbody>
                  {data.stations.map((s) => (
                    <tr key={s.id}>
                      <td><span className="swatch" style={{ background: s.color }} />{s.name}</td>
                      <td>{s.qty}</td><td>{mmss(s.avg_cook_sec)}</td><td>{mmss(s.avg_total_sec)}</td>
                      <td><span className={`badge ${lateTone(s.late_rate)}`}>{s.late_rate ?? '-'}%</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>메뉴별 조리 품질</h3>
            <table className="table">
              <thead><tr><th>메뉴</th><th>판매수량</th><th /><th>표준</th><th>평균 완료</th><th>초과율</th></tr></thead>
              <tbody>
                {data.menus.map((m) => (
                  <tr key={m.name}>
                    <td>{m.name}</td><td>{m.qty}</td>
                    <td style={{ width: '25%' }}><div className="hbar"><i style={{ width: `${(m.qty / maxQty) * 100}%` }} /></div></td>
                    <td>{m.target_minutes}분</td><td>{mmss(m.avg_total_sec)}</td>
                    <td><span className={`badge ${lateTone(m.late_rate)}`}>{m.late_rate ?? '-'}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.stores.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3>가맹점별 비교</h3>
              <table className="table">
                <thead><tr><th>매장</th><th>지점</th><th>주문</th><th>평균 조리완료</th><th>초과율</th></tr></thead>
                <tbody>
                  {data.stores.map((s) => (
                    <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setOrgId(s.id)}>
                      <td><b>{s.name}</b></td><td>{s.branch_name || '본부 직영'}</td><td>{s.orders}</td>
                      <td>{mmss(s.avg_ticket_sec)}</td>
                      <td><span className={`badge ${lateTone(s.late_rate)}`}>{s.late_rate ?? '-'}%</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
