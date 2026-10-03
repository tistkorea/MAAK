// 운영 품질 분석: 주문·조리 진행 이력으로 만드는 9개 분석 영역
import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { ErrorBox, Kpi } from '../components/ui.jsx';
import { ORG_TYPE, REQUEST_TYPE, ROLE_LABEL, SOURCE_LABEL, daysAgo, mmss, today } from '../format.js';

const tone = (r, warn = 10, bad = 20) => (r == null ? '' : r > bad ? 'late' : r > warn ? 'warn' : 'ok');
const pct = (r) => (r == null ? '-' : `${r}%`);
const DOW = ['월', '화', '수', '목', '금', '토', '일'];

const AREAS = [
  ['speed', '① 속도'], ['quality', '② 품질·표준'], ['loss', '③ 정확도·손실'], ['menu', '④ 메뉴'],
  ['table', '⑤ 테이블·고객'], ['staff', '⑥ 인력'], ['demand', '⑦ 수요'], ['channel', '⑧ 유입·요청'], ['stores', '⑨ 매장 비교'],
];

function Bar({ value, max, color }) {
  return <div className="hbar"><i style={{ width: `${max ? (value / max) * 100 : 0}%`, background: color }} /></div>;
}

function Table({ head, rows, empty = '데이터가 없습니다' }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows}</tbody>
      </table>
      {(!rows || !rows.length) && <div className="empty">{empty}</div>}
    </div>
  );
}

const Badge = ({ v, warn, bad }) => <span className={`badge ${tone(v, warn, bad)}`}>{pct(v)}</span>;

export default function Analytics() {
  const { user, can } = useAuth();
  const { data: orgs } = useApi(can('org:view') ? '/orgs' : null);
  const [orgId, setOrgId] = useState(user.orgId);
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(today());
  const [area, setArea] = useState('speed');
  const { data: d, error, loading } = useApi(`/analytics/summary?orgId=${orgId}&from=${from}&to=${to}`);
  const selectable = (orgs || []).filter((o) => o.type !== 'platform');
  const areas = AREAS.filter(([k]) => k !== 'stores' || d?.stores.length);

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
      {loading && !d && <div className="empty">불러오는 중…</div>}
      {d && (
        <>
          <div className="kpis">
            <Kpi label="주문 수" value={d.kpi.orders.toLocaleString()} hint={`${d.storeCount}개 매장 · 고객 ${d.kpi.guests.toLocaleString()}명`} />
            <Kpi label="첫 메뉴 제공" value={mmss(d.kpi.avg_first_item_sec)} hint="주문 → 첫 메뉴 조리완료" />
            <Kpi label="평균 조리완료" value={mmss(d.kpi.avg_ticket_sec)} hint="주문 → 전체 조리완료" />
            <Kpi label="픽업 대기" value={mmss(d.kpi.avg_pickup_sec)} hint="호출 → 제공 (음식 식는 시간)" tone={d.kpi.avg_pickup_sec > 120 ? 'warn' : undefined} />
            <Kpi label="표준시간 초과율" value={pct(d.kpi.late_rate)} tone={tone(d.kpi.late_rate)} />
            <Kpi label="수량 취소율" value={pct(d.kpi.qty ? Math.round((1000 * d.kpi.cancel_qty) / d.kpi.qty) / 10 : null)} hint={`${d.kpi.cancel_qty}개 / ${d.kpi.qty}개`} />
          </div>

          <div className="tabs" style={{ flexWrap: 'wrap' }}>
            {areas.map(([k, label]) => <button key={k} className={area === k ? 'on' : ''} onClick={() => setArea(k)}>{label}</button>)}
          </div>

          {area === 'speed' && <Speed d={d} />}
          {area === 'quality' && <Quality d={d} />}
          {area === 'loss' && <Loss d={d} />}
          {area === 'menu' && <Menu d={d} />}
          {area === 'table' && <Tables d={d} />}
          {area === 'staff' && <Staff d={d} />}
          {area === 'demand' && <Demand d={d} />}
          {area === 'channel' && <Channel d={d} />}
          {area === 'stores' && <Stores d={d} onPick={setOrgId} />}
        </>
      )}
    </div>
  );
}

function Speed({ d }) {
  const k = d.kpi;
  const steps = [
    ['조리 착수 대기', k.avg_start_wait_sec, '주문 → 조리 시작'],
    ['첫 메뉴 제공', k.avg_first_item_sec, '주문 → 첫 메뉴 조리완료'],
    ['전체 조리완료', k.avg_ticket_sec, '주문 → 마지막 메뉴 조리완료'],
    ['테이블 동시제공 편차', k.avg_sync_gap_sec, '같은 테이블 메뉴 완료시각 차이 (일행이 함께 먹는가)'],
    ['픽업 대기', k.avg_pickup_sec, '호출 → 제공'],
    ['패스 대기(주문 단위)', k.avg_pass_sec, '전체 조리완료 → 서빙완료'],
  ];
  const max = Math.max(...steps.map((s) => s[1] || 0));
  return (
    <div className="grid2" style={{ gap: 16, alignItems: 'start' }}>
      <div className="card">
        <h3>고객이 기다리는 시간 (평균)</h3>
        <table className="table"><tbody>
          {steps.map(([l, v, h]) => (
            <tr key={l}><td><b>{l}</b><div className="small muted">{h}</div></td><td style={{ width: 70 }}>{mmss(v)}</td><td style={{ width: '35%' }}><Bar value={v || 0} max={max} /></td></tr>
          ))}
        </tbody></table>
      </div>
      <div className="card">
        <h3>주방 파트(스테이션)별</h3>
        <Table head={['스테이션', '수량', '조리', '접수→완료', '픽업', '초과율']} rows={d.stations.map((s) => (
          <tr key={s.id}>
            <td><span className="swatch" style={{ background: s.color }} />{s.name}</td><td>{s.qty}</td>
            <td>{mmss(s.avg_cook_sec)}</td><td>{mmss(s.avg_total_sec)}</td><td>{mmss(s.avg_pickup_sec)}</td>
            <td><Badge v={s.late_rate} /></td>
          </tr>
        ))} />
      </div>
    </div>
  );
}

function Quality({ d }) {
  return (
    <div className="card">
      <h3>메뉴별 기준시간 준수</h3>
      <p className="small muted">조리시간 = 조리 시작 → 조리완료(호출). <b>과속</b>은 기준 하한보다 빠른 비율(덜 익힘·레시피 생략 의심), <b>지연</b>은 상한 초과 비율, <b>편차</b>가 크면 표준화(교육·레시피)가 필요한 메뉴입니다.</p>
      <Table head={['메뉴', '수량', '기준', '평균 조리', '편차(±)', '과속', '지연', '접수→완료 초과']} rows={d.menus.map((m) => (
        <tr key={m.name}>
          <td><b>{m.name}</b></td><td>{m.qty}</td>
          <td>{m.min_minutes ? `${m.min_minutes}~` : ''}{m.target_minutes}분</td>
          <td>{mmss(m.avg_cook_sec)}</td>
          <td><span className={m.sd_cook_sec > m.avg_cook_sec * 0.3 ? 'badge warn' : ''}>{mmss(m.sd_cook_sec)}</span></td>
          <td><Badge v={m.fast_rate} warn={5} bad={15} /></td>
          <td><Badge v={m.slow_rate} /></td>
          <td><Badge v={m.late_rate} /></td>
        </tr>
      ))} />
    </div>
  );
}

function Loss({ d }) {
  const max = Math.max(1, ...d.cancelReasons.map((r) => r.qty));
  return (
    <div className="grid2" style={{ gap: 16, alignItems: 'start' }}>
      <div className="card">
        <h3>메뉴별 취소 (조리 전/후)</h3>
        <p className="small muted">조리 시작 후 취소된 수량은 식재료·인건비 손실입니다.</p>
        <Table head={['메뉴', '취소 수량', '조리 후 취소(손실)', '부분취소 건']} rows={d.cancels.map((c) => (
          <tr key={c.name}><td>{c.name}</td><td>{c.cancel_qty}</td>
            <td><span className={c.after_start_qty ? 'badge late' : ''}>{c.after_start_qty}</span></td><td>{c.partial_events}</td></tr>
        ))} empty="취소 내역이 없습니다" />
      </div>
      <div className="card">
        <h3>취소 사유</h3>
        <Table head={['사유', '수량', '']} rows={d.cancelReasons.map((r) => (
          <tr key={r.reason}><td>{r.reason}</td><td>{r.qty}</td><td style={{ width: '45%' }}><Bar value={r.qty} max={max} color="var(--late)" /></td></tr>
        ))} />
      </div>
    </div>
  );
}

function Menu({ d }) {
  const max = Math.max(1, ...d.menus.map((m) => m.qty));
  // 주방 점유 = 수량 × 평균 조리시간
  const load = d.menus.map((m) => ({ ...m, load: (m.qty * (m.avg_cook_sec || 0)) / 60 })).sort((a, b) => b.load - a.load);
  const maxLoad = Math.max(1, ...load.map((m) => m.load));
  return (
    <div className="grid2" style={{ gap: 16, alignItems: 'start' }}>
      <div className="card">
        <h3>판매량 · 주방 점유</h3>
        <p className="small muted">주방 점유(분) = 수량 × 평균 조리시간. 많이 팔리면서 주방을 오래 붙잡는 메뉴가 피크 병목 후보입니다.</p>
        <Table head={['메뉴', '수량', '', '주방 점유', '']} rows={load.map((m) => (
          <tr key={m.name}><td>{m.name}</td><td>{m.qty}</td><td style={{ width: '22%' }}><Bar value={m.qty} max={max} /></td>
            <td>{Math.round(m.load)}분</td><td style={{ width: '22%' }}><Bar value={m.load} max={maxLoad} color="var(--warn)" /></td></tr>
        ))} />
      </div>
      <div className="card">
        <h3>함께 주문되는 메뉴 조합 TOP 10</h3>
        <p className="small muted">세트 구성, 동시 조리 설계(같은 타이밍에 완료되도록)에 활용합니다.</p>
        <Table head={['조합', '주문 수']} rows={d.pairs.map((p) => (
          <tr key={p.a + p.b}><td>{p.a} + {p.b}</td><td>{p.orders}</td></tr>
        ))} />
      </div>
    </div>
  );
}

function Tables({ d }) {
  return (
    <div className="card">
      <h3>인원별 주문 · 체류 (매장 식사)</h3>
      <p className="small muted">체류 = 첫 주문 → 마지막 메뉴 제공. 인원당 주문 수량은 메뉴 구성·추천 개선에, 체류시간은 회전율 관리에 씁니다. 가격 데이터를 연결하면 인원당 객단가도 계산할 수 있습니다.</p>
      <Table head={['인원', '주문', '인원당 메뉴 수', '평균 조리완료', '평균 체류(제공까지)']} rows={d.tables.map((t) => (
        <tr key={t.bucket}><td><b>{t.bucket}</b></td><td>{t.orders}</td><td>{t.qty_per_guest ?? '-'}</td><td>{mmss(t.avg_ticket_sec)}</td><td>{mmss(t.avg_dwell_sec)}</td></tr>
      ))} />
    </div>
  );
}

function Staff({ d }) {
  const max = Math.max(1, ...d.workers.map((w) => w.cooked_qty));
  return (
    <div className="card">
      <h3>작업자별 처리 (조리 진행 이력 기준)</h3>
      <p className="small muted">조리 수량은 일부완료·호출 처리 수량, 제공 수량은 완료 처리 수량입니다. 평균 조리·지연율은 해당 작업자가 조리완료한 품목 기준이며, 교육 효과와 근무 배치 판단에 활용합니다.</p>
      <Table head={['작업자', '역할', '조리 수량', '', '제공 수량', '평균 조리', '지연율', '되돌림', '취소 처리']} rows={d.workers.map((w) => (
        <tr key={w.id}><td><b>{w.name}</b></td><td className="small">{ROLE_LABEL[w.role]}</td><td>{w.cooked_qty}</td>
          <td style={{ width: '18%' }}><Bar value={w.cooked_qty} max={max} /></td><td>{w.served_qty}</td>
          <td>{mmss(w.avg_cook_sec)}</td><td><Badge v={w.slow_rate} /></td><td>{w.recalls}</td><td>{w.cancel_qty}</td></tr>
      ))} />
    </div>
  );
}

function Demand({ d }) {
  const max = Math.max(1, ...d.heatmap.map((h) => h.orders));
  const hours = Array.from({ length: 13 }, (_, i) => i + 10); // 10~22시
  const cell = (dow, h) => d.heatmap.find((x) => x.dow === dow && x.hour === h)?.orders || 0;
  const maxHour = Math.max(1, ...d.hourly.map((h) => h.orders));
  return (
    <div className="grid2" style={{ gap: 16, alignItems: 'start' }}>
      <div className="card">
        <h3>요일 × 시간대 주문</h3>
        <p className="small muted">사전 준비량(프렙)·근무 배치·식재료 발주 예측의 기초 데이터입니다.</p>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 11 }}>
            <thead><tr><th />{hours.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {DOW.map((dl, i) => (
                <tr key={dl}><th>{dl}</th>{hours.map((h) => {
                  const v = cell(i + 1, h);
                  return <td key={h} title={`${dl} ${h}시 · ${v}건`} style={{ background: v ? `rgba(180, 83, 9, ${0.12 + 0.88 * (v / max)})` : undefined, color: v / max > 0.55 ? '#fff' : undefined, textAlign: 'center' }}>{v || ''}</td>;
                })}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h3>시간대별 주문 · 조리완료 시간</h3>
        <Table head={['시간', '주문', '', '평균 조리완료']} rows={d.hourly.map((h) => (
          <tr key={h.hour}><td>{h.hour}시</td><td>{h.orders}</td><td style={{ width: '40%' }}><Bar value={h.orders} max={maxHour} /></td><td>{mmss(h.avg_ticket_sec)}</td></tr>
        ))} />
      </div>
    </div>
  );
}

function Channel({ d }) {
  return (
    <div className="grid2" style={{ gap: 16, alignItems: 'start' }}>
      <div className="card">
        <h3>유입경로별 비교</h3>
        <Table head={['경로', '주문', '평균 수량', '평균 조리완료', '전체취소율', '취소 포함률']} rows={d.channels.map((c) => (
          <tr key={c.source}><td><b>{SOURCE_LABEL[c.source]}</b></td><td>{c.orders}</td><td>{c.avg_qty}</td>
            <td>{mmss(c.avg_ticket_sec)}</td><td>{pct(c.cancel_rate)}</td><td><Badge v={c.any_cancel_rate} warn={5} bad={10} /></td></tr>
        ))} />
      </div>
      <div className="card">
        <h3>직원 호출 · 고객 요청</h3>
        <p className="small muted">재촉 요청은 대기시간 불만의 직접 지표입니다.</p>
        <Table head={['구분', '유형', '건수', '응답', '처리완료']} rows={d.requests.map((q) => (
          <tr key={q.type + q.category}><td>{REQUEST_TYPE[q.type]}</td><td><b>{q.category}</b></td><td>{q.count}</td>
            <td>{mmss(q.avg_ack_sec)}</td><td>{mmss(q.avg_done_sec)}</td></tr>
        ))} />
      </div>
    </div>
  );
}

function Stores({ d, onPick }) {
  return (
    <div className="card">
      <h3>가맹점 비교</h3>
      <p className="small muted">매장을 누르면 해당 매장 분석으로 이동합니다.</p>
      <Table head={['매장', '지점', '주문', '평균 조리완료', '패스 대기', '초과율', '취소율']} rows={d.stores.map((s) => (
        <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => onPick(s.id)}>
          <td><b>{s.name}</b></td><td>{s.branch_name || '본부 직영'}</td><td>{s.orders}</td>
          <td>{mmss(s.avg_ticket_sec)}</td><td>{mmss(s.avg_pass_sec)}</td><td><Badge v={s.late_rate} /></td><td>{pct(s.cancel_rate)}</td>
        </tr>
      ))} />
    </div>
  );
}
