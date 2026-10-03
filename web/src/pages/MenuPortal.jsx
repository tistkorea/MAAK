// MENU PORTAL · Kitchen Control System
// 모든 주문(POS·테이블오더·주방프린터)과 직원 호출·고객 요청을 한 화면에서 테이블 단위로 관리한다.
//  - 테이블 카드: 메뉴별 상태·경과시간, 하단 5버튼(호출/대기/조리중/완료/취소)
//  - 상세 패널: 테이블별 메뉴 관리 + 메뉴별 진행 관리(진행 수량, 조리시간 vs 기준, 조리 진행 이력)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, patch, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useNow } from '../hooks.js';
import { useStoreSocket } from '../socket.js';
import {
  CANCEL_REASONS, EVENT_LABEL, EVENT_STATUS, ORDER_TYPE, REQUEST_TYPE, SOURCE_LABEL, STATUS_META, elapsedSec, hm, hms, mmss,
} from '../format.js';
import { Field, Modal, toastError } from '../components/ui.jsx';
import '../portal.css';

const OPEN = ['pending', 'cooking', 'partial', 'ready'];
const TABS = [['all', '전체'], ['pending', '대기'], ['ready', '호출'], ['cooking', '조리중'], ['served', '완료'], ['cancelled', '취소']];
const LEGEND = ['served', 'partial', 'pending', 'cooking', 'ready', 'partial_cancel', 'cancelled'];
const ACTIONS = [['ready', '호출', '🔔'], ['pending', '대기', '⧗'], ['cooking', '조리중', '🔥'], ['served', '완료', '✔'], ['cancel', '취소', '✕']];
const NEXT = { pending: 'cooking', cooking: 'ready', partial: 'ready', ready: 'served' };

let audioCtx;
function beep(freq = 880) {
  try {
    audioCtx ||= new AudioContext();
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.frequency.value = freq; o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.25, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);
    o.start(); o.stop(audioCtx.currentTime + 0.45);
  } catch { /* 오디오 미지원 */ }
}

export function Chip({ status, big, onClick, title }) {
  const m = STATUS_META[status] || { label: status, icon: '' };
  return (
    <button type="button" className={`pchip s-${status} ${big ? 'big' : ''}`} onClick={onClick} title={title} tabIndex={onClick ? 0 : -1}>
      <span aria-hidden>{m.icon}</span>{m.label}
    </button>
  );
}

// 상태별 시간 표시: 조리중=조리 경과, 호출=픽업 대기, 완료=총 소요
function itemTime(it, now) {
  switch (it.status) {
    case 'cooking':
    case 'partial': {
      const e = elapsedSec(it.started_at, now);
      const total = elapsedSec(it.order.created_at, now);
      return { text: mmss(e), level: total > it.target_minutes * 60 ? 'late' : total > it.target_minutes * 42 ? 'warn' : '' };
    }
    case 'pending': {
      const w = elapsedSec(it.order.created_at, now);
      return { text: '-', level: w > it.target_minutes * 60 ? 'late' : w > 180 ? 'warn' : '' };
    }
    case 'ready': {
      const w = elapsedSec(it.done_at, now);
      return { text: mmss(w), level: w > 180 ? 'late' : w > 90 ? 'warn' : '' };
    }
    case 'served': return { text: mmss((new Date(it.served_at) - new Date(it.order.created_at)) / 1000), level: '' };
    default: return { text: '-', level: '' };
  }
}

function groupTables(orders) {
  const map = new Map();
  for (const o of orders) {
    const key = o.order_type === 'dine_in' && o.table_no ? `T${o.table_no}` : `O${o.id}`;
    if (!map.has(key)) {
      map.set(key, {
        key, tableNo: o.order_type === 'dine_in' ? o.table_no : null, orderType: o.order_type,
        displayNo: o.display_no, orders: [], items: [],
      });
    }
    const t = map.get(key);
    t.orders.push(o);
    for (const it of o.items) t.items.push({ ...it, order: o });
  }
  return [...map.values()].map((t) => ({
    ...t,
    createdAt: t.orders.reduce((m, o) => (o.created_at < m ? o.created_at : m), t.orders[0].created_at),
    guests: Math.max(0, ...t.orders.map((o) => o.guest_count || 0)) || null,
    rush: t.orders.some((o) => o.rush),
    open: t.items.some((i) => OPEN.includes(i.status)),
    memo: t.orders.map((o) => o.memo).filter(Boolean).join(' / '),
    sources: [...new Set(t.orders.map((o) => o.source))],
    partialCancel: t.items.some((i) => i.cancel_qty > 0 && i.status !== 'cancelled'),
  }));
}

export default function MenuPortal() {
  const { storeId, store, stores, setStoreId, can } = useAuth();
  const [orders, setOrders] = useState([]);
  const [requests, setRequests] = useState([]);
  const [menu, setMenu] = useState([]);
  const [tab, setTab] = useState('all');
  const [view, setView] = useState('grid');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState({}); // tableKey → itemId
  const [detail, setDetail] = useState(null); // tableKey
  const [cancelItem, setCancelItem] = useState(null);
  const [newReq, setNewReq] = useState(false);
  const [conn, setConn] = useState('offline');
  const [sound, setSound] = useState(true);
  const now = useNow(1000);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const loadOrders = useCallback(() => api(`/stores/${storeId}/orders`).then(setOrders).catch(toastError), [storeId]);
  const loadRequests = useCallback(() => api(`/stores/${storeId}/requests`).then(setRequests).catch(() => {}), [storeId]);
  useEffect(() => {
    loadOrders(); loadRequests();
    api(`/stores/${storeId}/menu`).then(setMenu).catch(() => {});
  }, [storeId, loadOrders, loadRequests]);
  useEffect(() => { const t = setInterval(() => { loadOrders(); loadRequests(); }, 30000); return () => clearInterval(t); }, [loadOrders, loadRequests]);

  const upsert = useCallback((o) => setOrders((cur) => {
    const i = cur.findIndex((x) => x.id === o.id);
    if (i < 0) return [...cur, o];
    const next = [...cur]; next[i] = o; return next;
  }), []);

  useStoreSocket(storeId, {
    'order:created': (o) => { upsert(o); if (soundRef.current) beep(880); },
    'order:updated': upsert,
    'request:changed': (q) => {
      if (q.status === 'open' && soundRef.current) beep(660);
      loadRequests();
    },
    onReconnect: () => { loadOrders(); loadRequests(); },
  }, setConn);

  const act = async (item, action, body) => {
    if (action === 'cancel') { setCancelItem(item); return; }
    try { upsert(await post(`/orders/items/${item.id}/${action}`, body)); } catch (e) { toastError(e); }
  };

  const tables = useMemo(() => groupTables(orders), [orders]);
  const menuById = useMemo(() => new Map(menu.map((m) => [m.id, m])), [menu]);

  const hasStatus = (t, s) => t.items.some((i) => (s === 'cooking' ? ['cooking', 'partial'].includes(i.status) : i.status === s));
  const tabCount = (s) => tables.filter((t) => (s === 'all' ? t.open : hasStatus(t, s))).length;
  const q = search.trim().toLowerCase();
  const visible = tables
    .filter((t) => (tab === 'all' ? t.open : hasStatus(t, tab)))
    .filter((t) => !q || (t.tableNo || '').toLowerCase() === q.replace(/^t/, '') || t.items.some((i) => i.name.toLowerCase().includes(q)))
    .sort((a, b) => (b.rush - a.rush) || (b.open - a.open) || a.createdAt.localeCompare(b.createdAt));

  const openTables = tables.filter((t) => t.open);
  const count = (pred) => openTables.reduce((s, t) => s + t.items.filter(pred).length, 0);
  const counts = {
    pending: count((i) => i.status === 'pending'),
    cooking: count((i) => ['cooking', 'partial'].includes(i.status)),
    ready: count((i) => i.status === 'ready'),
    served: tables.reduce((s, t) => s + t.items.filter((i) => i.status === 'served').length, 0),
  };
  const openReqs = requests.filter((r) => ['open', 'ack'].includes(r.status));
  const nowDate = new Date(now);

  const selectedItem = (t) => t.items.find((i) => i.id === selected[t.key])
    || t.items.find((i) => OPEN.includes(i.status)) || t.items[0];
  const tableLabel = (t) => (t.tableNo ? <>테이블 <b>{String(t.tableNo).padStart(2, '0')}</b></> : <>{ORDER_TYPE[t.orderType]} <b>#{t.displayNo}</b></>);
  const level = (t) => {
    if (!t.open) return 'closed';
    const lv = t.items.map((i) => itemTime(i, now).level);
    return lv.includes('late') ? 'late' : lv.includes('warn') ? 'warn' : '';
  };
  const reqAct = async (r, status) => {
    try { await patch(`/stores/${storeId}/requests/${r.id}`, { status }); loadRequests(); } catch (e) { toastError(e); }
  };
  const detailTable = tables.find((t) => t.key === detail);

  return (
    <div className="portal">
      <header className="p-head">
        <Link to="/" className="p-logo" title="관리 포털로"><i />MENU PORTAL</Link>
        <div className="p-clock">
          <small>현재 시각</small>
          <b>{hms(nowDate)}</b>
          <small>{nowDate.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })}</small>
        </div>
        <div className="p-count">📋 주문 대기 <b>{counts.pending}</b>건</div>
        <div className="p-count cooking">🔥 조리중 <b>{counts.cooking}</b>건</div>
        <div className="p-count ready">🔔 호출 <b>{counts.ready}</b>건</div>
        <div className="p-count">✔ 완료 <b>{counts.served}</b>건</div>
        <div style={{ flex: 1 }} />
        <span className={`p-conn ${conn}`} title={conn === 'online' ? '실시간 연결됨' : '연결 끊김 - 재연결 중'} />
        <strong>{store?.name}</strong>
        {stores.length > 1 && (
          <select value={storeId} onChange={(e) => setStoreId(Number(e.target.value))} aria-label="매장">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <button className="p-btn" onClick={() => setNewReq(true)}>＋ 호출·요청</button>
        <button className="p-btn" onClick={() => setSound((v) => !v)}>{sound ? '🔔' : '🔕'}</button>
        <button className="p-btn" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}>⛶</button>
        <Link className="p-btn" to="/kds">스테이션 KDS</Link>
      </header>

      <div className="p-tools">
        {TABS.map(([k, label]) => (
          <button key={k} className={`p-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{label} ({tabCount(k)})</button>
        ))}
        <label className="p-search">🔍<input placeholder="테이블 번호 또는 메뉴 검색" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <div className="p-view">
          <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} title="카드 보기" aria-label="카드 보기">▦</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} title="목록 보기" aria-label="목록 보기">☰</button>
        </div>
      </div>

      {openReqs.length > 0 && (
        <div className="p-requests" aria-label="직원 호출·고객 요청">
          {openReqs.map((r) => (
            <div key={r.id} className={`p-req ${r.type} ${r.status}`}>
              <b>{r.table_no ? `T${r.table_no}` : '-'}</b>
              <span>{REQUEST_TYPE[r.type]} · {r.category || ''}{r.message ? ` "${r.message}"` : ''}</span>
              <span className="tm">{mmss(elapsedSec(r.created_at, now))}</span>
              {r.status === 'open' && <button className="sub" onClick={() => reqAct(r, 'ack')}>확인</button>}
              <button onClick={() => reqAct(r, 'done')}>처리완료</button>
            </div>
          ))}
        </div>
      )}

      {view === 'grid' ? (
        <div className="p-grid">
          {visible.map((t) => {
            const sel = selectedItem(t);
            return (
              <article key={t.key} className={`p-card ${level(t)} ${t.rush ? 'rush' : ''}`}>
                <div className="p-card-head">
                  <span className="t">{tableLabel(t)}</span>
                  <span className="m">{hm(t.createdAt)}</span>
                  {t.guests && <span className="g">👤 {t.guests}명</span>}
                  <button className="p-kebab" onClick={() => setDetail(t.key)} aria-label="상세" style={t.guests ? undefined : { marginLeft: 'auto' }}>⋮</button>
                </div>
                <div className="p-badges">
                  {t.rush && <span className="p-badge rush">긴급</span>}
                  {t.sources.map((s) => <span key={s} className="p-badge">{SOURCE_LABEL[s]}</span>)}
                  {t.orders.length > 1 && <span className="p-badge">추가주문 {t.orders.length - 1}</span>}
                </div>
                <div className="p-rows">
                  {t.items.map((it, idx) => {
                    const tm = itemTime(it, now);
                    const live = it.qty - it.cancel_qty;
                    return (
                      <div key={it.id} className={`p-row ${it.status} ${sel?.id === it.id ? 'sel' : ''}`}
                        onClick={() => setSelected((s) => ({ ...s, [t.key]: it.id }))}
                        onDoubleClick={() => { setSelected((s) => ({ ...s, [t.key]: it.id })); setDetail(t.key); }}>
                        <span className="no">{idx + 1}</span>
                        <span className="nm">{it.name}{it.options && <small>└ {it.options}</small>}</span>
                        <span className="qty">{live}{(it.status === 'partial' || it.cancel_qty > 0) && (
                          <small>{it.status === 'partial' ? `${it.done_qty}/${live}` : `-${it.cancel_qty}`}</small>
                        )}</span>
                        <Chip status={it.status}
                          title={NEXT[it.status] ? `눌러서 ${STATUS_META[NEXT[it.status]].label}` : ''}
                          onClick={(e) => { e.stopPropagation(); if (NEXT[it.status]) act(it, NEXT[it.status]); }} />
                        <span className={`tm ${tm.level}`}>{tm.text}</span>
                      </div>
                    );
                  })}
                </div>
                {t.memo && <div className="p-memo">📝 {t.memo}</div>}
                <div className="p-actions">
                  {ACTIONS.map(([a, label, icon]) => (
                    <button key={a} className={`p-act a-${a}`} disabled={!sel || sel.status === 'cancelled' || (a === 'cancel' && !can('order:manage'))}
                      title={sel ? `${sel.name} → ${label}` : ''} onClick={() => act(sel, a)}>
                      <span>{icon}</span>{label}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
          {!visible.length && <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#6b7280', padding: 40 }}>해당하는 주문이 없습니다</div>}
        </div>
      ) : (
        <div className="p-list">
          <table>
            <thead><tr><th>테이블</th><th>메뉴</th><th>수량</th><th>상태</th><th>시간</th><th>유입</th><th>처리</th></tr></thead>
            <tbody>
              {visible.flatMap((t) => t.items.map((it) => {
                const tm = itemTime(it, now);
                return (
                  <tr key={it.id}>
                    <td onClick={() => setDetail(t.key)} style={{ cursor: 'pointer' }}><b>{tableLabel(t)}</b></td>
                    <td>{it.name}{it.options && <div style={{ fontSize: 11, color: '#b45309' }}>└ {it.options}</div>}</td>
                    <td>{it.status === 'partial' ? `${it.done_qty}/${it.qty - it.cancel_qty}` : it.qty - it.cancel_qty}</td>
                    <td><Chip status={it.status} /></td>
                    <td className={`tm ${tm.level}`}>{tm.text}</td>
                    <td>{SOURCE_LABEL[it.order.source]}</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      {ACTIONS.map(([a, label]) => (
                        <button key={a} className={`p-act a-${a}`} style={{ padding: '4px 8px' }}
                          disabled={it.status === 'cancelled' || (a === 'cancel' && !can('order:manage'))} onClick={() => act(it, a)}>{label}</button>
                      ))}
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      )}

      <div className="p-legend">
        <h4>조리 상태</h4>
        {LEGEND.map((s) => <div key={s}><Chip status={s} big /><span>{STATUS_META[s].desc}</span></div>)}
      </div>

      {detailTable && (
        <DetailPanel table={detailTable} now={now} menuById={menuById} can={can}
          selectedId={selectedItem(detailTable)?.id}
          onSelect={(id) => setSelected((s) => ({ ...s, [detailTable.key]: id }))}
          onAct={act} onClose={() => setDetail(null)} tableLabel={tableLabel} />
      )}
      {cancelItem && (
        <CancelDialog item={cancelItem} onClose={() => setCancelItem(null)}
          onDone={(o) => { upsert(o); setCancelItem(null); }} />
      )}
      {newReq && <RequestDialog storeId={storeId} onClose={() => setNewReq(false)} onDone={() => { setNewReq(false); loadRequests(); }} />}
    </div>
  );
}

function DetailPanel({ table, now, menuById, can, selectedId, onSelect, onAct, onClose, tableLabel }) {
  const item = table.items.find((i) => i.id === selectedId) || table.items[0];
  const [events, setEvents] = useState([]);
  const [showRecipe, setShowRecipe] = useState(false);
  const stamp = `${item.id}:${item.status}:${item.done_qty}:${item.cancel_qty}`;
  useEffect(() => {
    api(`/orders/${item.order_id}/events`).then(setEvents).catch(() => {});
  }, [item.order_id, stamp]);

  const live = item.qty - item.cancel_qty;
  const cookSec = item.started_at ? ((item.done_at ? new Date(item.done_at).getTime() : now) - new Date(item.started_at).getTime()) / 1000 : null;
  const min = item.min_minutes; const max = item.target_minutes;
  const cookLevel = cookSec == null ? '' : cookSec > max * 60 ? 'late' : min && cookSec < min * 60 && item.done_at ? 'late' : item.done_at ? 'ok' : '';
  const history = events.filter((e) => e.item_id === item.id);
  const recipe = item.menu_item_id ? menuById.get(item.menu_item_id) : null;
  const canProgress = ['pending', 'cooking', 'partial', 'ready'].includes(item.status);
  const no = table.items.findIndex((i) => i.id === item.id) + 1;

  return (
    <>
      <div className="p-drawer-back" onClick={onClose} />
      <aside className="p-drawer" role="dialog" aria-label="테이블 상세">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>{tableLabel(table)}</h2>
          <button className="p-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        <section className="p-sec orange">
          <h3><em>03</em>테이블별 메뉴 관리</h3>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
            {table.guests ? `${table.guests}명 · ` : ''}주문 시작 {hm(table.createdAt)}
            {' · '}{table.sources.map((s) => SOURCE_LABEL[s]).join(', ')}
          </div>
          {table.items.map((it) => (
            <div key={it.id} className={`p-mrow ${it.id === item.id ? 'sel' : ''}`} onClick={() => onSelect(it.id)}>
              <span className="nm">{it.name}{it.options && <small style={{ display: 'block', color: '#b45309', fontWeight: 500 }}>└ {it.options}</small>}</span>
              <span>{it.qty - it.cancel_qty}</span>
              <Chip status={it.status} big />
            </div>
          ))}
        </section>

        <section className="p-sec violet">
          <h3><em>04</em>메뉴별 진행 관리</h3>
          <b>{tableLabel(table)} › {no}. {item.name}</b>
          <div className="p-boxes">
            <div className="p-box">
              <small>진행 수량</small>
              <div className="p-step">
                <button disabled={!canProgress || item.done_qty <= 0} onClick={() => onAct(item, 'progress', { doneQty: item.done_qty - 1 })} aria-label="감소">−</button>
                <span className="big" style={{ fontSize: 24, fontWeight: 900, color: '#ea580c' }}>{item.status === 'served' ? live : item.done_qty} / {live}</span>
                <button disabled={!canProgress || item.done_qty >= live} onClick={() => onAct(item, 'progress', { doneQty: item.done_qty + 1 })} aria-label="증가">＋</button>
              </div>
              <div className="p-bar"><i style={{ width: `${live ? ((item.status === 'served' ? live : item.done_qty) / live) * 100 : 0}%` }} /></div>
              <small style={{ marginTop: 4 }}>{live ? Math.round(((item.status === 'served' ? live : item.done_qty) / live) * 100) : 0}% 완료{item.cancel_qty ? ` · 취소 ${item.cancel_qty}` : ''}</small>
            </div>
            <div className="p-box">
              <small>조리 시간</small>
              <div className={`big ${cookLevel}`}>{cookSec == null ? '-' : `${Math.floor(cookSec / 60)}분 ${String(Math.floor(cookSec % 60)).padStart(2, '0')}초`}</div>
              <small>(기준 {min ? `${min}~` : ''}{max}분)</small>
            </div>
          </div>
          <div className="p-actions" style={{ border: 'none', padding: '0 0 10px' }}>
            {ACTIONS.map(([a, label, icon]) => (
              <button key={a} className={`p-act a-${a}`} disabled={item.status === 'cancelled' || (a === 'cancel' && !can('order:manage'))}
                onClick={() => onAct(item, a)}><span>{icon}</span>{label}</button>
            ))}
          </div>
          {recipe?.recipe?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <button className="p-btn" onClick={() => setShowRecipe((v) => !v)}>📖 표준 레시피 {showRecipe ? '접기' : '보기'}</button>
              {showRecipe && <ol className="p-recipe">{recipe.recipe.map((s, i) => <li key={i}>{s}</li>)}</ol>}
            </div>
          )}
          <h4 style={{ margin: '6px 0' }}>조리 진행 이력</h4>
          <table className="p-hist">
            <thead><tr><th>시간</th><th>상태</th><th>수량</th><th>작업자</th></tr></thead>
            <tbody>
              {history.map((e) => (
                <tr key={e.id}>
                  <td>{hms(e.created_at)}</td>
                  <td>
                    <span className={`pchip s-${STATUS_META[e.event] ? e.event : EVENT_STATUS[e.event] || 'pending'}`} style={{ cursor: 'default' }}>
                      {EVENT_LABEL[e.event]}
                    </span>
                    {e.reason && <div style={{ fontSize: 11, color: '#6b7280' }}>{e.reason}</div>}
                  </td>
                  <td>{e.qty ?? '-'}</td>
                  <td>{e.user_name || (e.event === 'received' ? '시스템' : '-')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </aside>
    </>
  );
}

function CancelDialog({ item, onClose, onDone }) {
  const open = item.status === 'served' ? 0 : item.qty - item.cancel_qty;
  const [qty, setQty] = useState(open);
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const submit = async () => {
    try { onDone(await post(`/orders/items/${item.id}/cancel`, { qty: Number(qty), reason })); } catch (e) { toastError(e); }
  };
  return (
    <Modal title={`${item.name} 취소`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>닫기</button><button className="btn danger" disabled={!open} onClick={submit}>{Number(qty) < open ? '부분취소' : '전체취소'}</button></>}>
      {!open && <p className="error">제공 완료된 품목은 취소할 수 없습니다.</p>}
      <Field label={`취소 수량 (최대 ${open})`}>
        <input className="input" type="number" min="1" max={open} value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>
      <Field label="취소 사유">
        <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
          {CANCEL_REASONS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </Field>
    </Modal>
  );
}

function RequestDialog({ storeId, onClose, onDone }) {
  const [form, setForm] = useState({ type: 'customer_request', tableNo: '', category: '물', message: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    try { await post(`/stores/${storeId}/requests`, { ...form, tableNo: form.tableNo || null, message: form.message || null }); onDone(); } catch (e) { toastError(e); }
  };
  return (
    <Modal title="직원 호출 · 고객 요청 등록" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>닫기</button><button className="btn primary" onClick={submit}>등록</button></>}>
      <div className="grid2">
        <Field label="구분">
          <select className="input" value={form.type} onChange={set('type')}>
            <option value="customer_request">고객 요청</option><option value="staff_call">직원 호출</option>
          </select>
        </Field>
        <Field label="테이블"><input className="input" value={form.tableNo} onChange={set('tableNo')} /></Field>
      </div>
      <Field label="유형">
        <select className="input" value={form.category} onChange={set('category')}>
          {['물', '앞접시', '추가 반찬', '수저', '재촉', '계산', '직원 호출', '기타'].map((c) => <option key={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="메시지"><input className="input" value={form.message} onChange={set('message')} /></Field>
    </Modal>
  );
}
