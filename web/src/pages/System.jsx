import { useEffect } from 'react';
import { useApi } from '../hooks.js';
import { ErrorBox, Kpi } from '../components/ui.jsx';
import { dt } from '../format.js';

export default function SystemPage() {
  const { data, error, reload } = useApi('/system/stats');
  useEffect(() => { const t = setInterval(reload, 10000); return () => clearInterval(t); }, [reload]);
  if (!data) return <ErrorBox error={error} />;
  const { counts, realtime, process: p, devices } = data;
  const up = `${Math.floor(p.uptimeSec / 3600)}시간 ${Math.floor((p.uptimeSec % 3600) / 60)}분`;
  return (
    <div>
      <h1>시스템 모니터링</h1>
      <div className="kpis">
        <Kpi label="가맹본부" value={counts.hq} />
        <Kpi label="가맹지점" value={counts.branches} />
        <Kpi label="가맹점" value={counts.stores} />
        <Kpi label="사용자" value={counts.users} />
        <Kpi label="진행중 주문" value={counts.active_orders} />
        <Kpi label="24시간 주문" value={counts.orders_24h} />
        <Kpi label="실시간 연결" value={realtime.connections} />
        <Kpi label="DB 크기" value={`${(counts.db_bytes / 1048576).toFixed(1)}MB`} />
      </div>
      <div className="grid2" style={{ gap: 16, alignItems: 'start' }}>
        <div className="card">
          <h3>서버 프로세스</h3>
          <table className="table"><tbody>
            <tr><th>가동시간</th><td>{up}</td></tr>
            <tr><th>메모리(RSS)</th><td>{p.memoryMb}MB</td></tr>
            <tr><th>Node</th><td>{p.node}</td></tr>
            <tr><th>Load avg</th><td>{p.loadavg.map((x) => x.toFixed(2)).join(' / ')}</td></tr>
            <tr><th>DB 풀</th><td>전체 {p.dbPool.total} · 유휴 {p.dbPool.idle} · 대기 {p.dbPool.waiting}</td></tr>
            <tr><th>매장 룸</th><td>{Object.entries(realtime.rooms).map(([k, v]) => `${k}(${v})`).join(', ') || '-'}</td></tr>
          </tbody></table>
        </div>
        <div className="card">
          <h3>연결 디바이스</h3>
          <table className="table">
            <thead><tr><th>매장</th><th>이름</th><th>유형</th><th>최근 통신</th></tr></thead>
            <tbody>{devices.map((d) => <tr key={d.id}><td>{d.store_name}</td><td>{d.name}</td><td>{d.type}</td><td className="small">{dt(d.last_seen_at)}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
