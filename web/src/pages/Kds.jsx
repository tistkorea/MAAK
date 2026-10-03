// KDS(Kitchen Display) 화면
//  - 스테이션 화면: 해당 주방 파트 품목만 티켓으로 표시, 품목 탭(대기→조리중→완료), BUMP(일괄 완료), 리콜
//  - 패스(Expo) 화면: 주문 전체 진행률, 조리완료 → 서빙 완료 처리
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useNow } from '../hooks.js';
import { useStoreSocket } from '../socket.js';
import { elapsedSec, mmss } from '../format.js';
import TicketCard from '../components/TicketCard.jsx';
import { Modal, toastError } from '../components/ui.jsx';

let audioCtx;
function beep() {
  try {
    audioCtx ||= new AudioContext();
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.25, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    o.start(); o.stop(audioCtx.currentTime + 0.5);
  } catch { /* 오디오 미지원 */ }
}

const ACTIVE = ['received', 'cooking', 'ready'];
const ITEM_NEXT = { pending: 'cooking', cooking: 'ready', partial: 'ready', ready: 'recall', served: 'recall' };
const cooked = (i) => i.status === 'ready' || i.status === 'served';

export default function Kds() {
  const { storeId, store, stores, setStoreId, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [stations, setStations] = useState([]);
  const [menu, setMenu] = useState([]);
  const [orders, setOrders] = useState([]);
  const [conn, setConn] = useState('offline');
  const [sound, setSound] = useState(true);
  const [recipe, setRecipe] = useState(null);
  const now = useNow(1000);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const stationParam = params.get('station');
  const expoMode = params.get('view') === 'expo' || stations.find((s) => String(s.id) === stationParam)?.is_expo;
  const stationId = stationParam && stationParam !== 'all' ? Number(stationParam) : null;
  const station = stations.find((s) => s.id === stationId);

  const loadOrders = useCallback(() => api(`/stores/${storeId}/orders`).then(setOrders).catch(toastError), [storeId]);
  const loadStations = useCallback(() => api(`/stores/${storeId}/stations`).then(setStations).catch(toastError), [storeId]);
  const loadMenu = useCallback(() => api(`/stores/${storeId}/menu`).then(setMenu).catch(() => {}), [storeId]);

  useEffect(() => { loadOrders(); loadStations(); loadMenu(); }, [loadOrders, loadStations, loadMenu]);
  // 소켓 유실 대비 주기적 동기화
  useEffect(() => { const t = setInterval(loadOrders, 30000); return () => clearInterval(t); }, [loadOrders]);

  const upsert = useCallback((o) => setOrders((cur) => {
    const i = cur.findIndex((x) => x.id === o.id);
    if (i < 0) return [...cur, o];
    const next = [...cur]; next[i] = o; return next;
  }), []);

  useStoreSocket(storeId, {
    'order:created': (o) => {
      upsert(o);
      const relevant = !stationId || expoMode || o.items.some((i) => i.station_id === stationId);
      if (soundRef.current && relevant) beep();
    },
    'order:updated': upsert,
    'menu:changed': loadMenu,
    'stations:changed': loadStations,
    onReconnect: loadOrders,
  }, setConn);

  const act = async (path, body) => {
    try { upsert(await post(path, body)); } catch (e) { toastError(e); loadOrders(); }
  };

  const menuById = useMemo(() => new Map(menu.map((m) => [m.id, m])), [menu]);
  const choose = (next) => setParams(next);

  const bar = (
    <div className="kds-bar">
      <Link to="/" className="btn sm">← 관리</Link>
      <span className={`conn ${conn}`} title={conn === 'online' ? '실시간 연결됨' : '연결 끊김 - 재연결 중'} />
      <span className="kds-title">{store?.name} · {expoMode ? '패스(서빙)' : station?.name || (stationParam === 'all' ? '전체 주방' : 'KDS')}</span>
      {stores.length > 1 && (
        <select value={storeId} onChange={(e) => setStoreId(Number(e.target.value))} aria-label="매장">
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <div className="spacer" />
      <select value={expoMode ? 'expo' : stationParam || ''} aria-label="스테이션"
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'expo') choose({ view: 'expo' });
          else if (v) choose({ station: v });
          else choose({});
        }}>
        <option value="">스테이션 선택</option>
        <option value="all">전체 주방</option>
        {stations.filter((s) => !s.is_expo).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        <option value="expo">패스(서빙)</option>
      </select>
      <button className="btn sm" onClick={() => setSound((v) => !v)}>{sound ? '🔔 알림음' : '🔕 무음'}</button>
      <button className="btn sm" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()}>⛶ 전체화면</button>
    </div>
  );

  const recipeModal = recipe && (
    <Modal title={`${recipe.name} · 표준 레시피`} onClose={() => setRecipe(null)}
      footer={<button className="btn" onClick={() => setRecipe(null)}>닫기</button>}>
      <p className="muted">표준 조리시간 {recipe.target_minutes}분 {recipe.allergens?.length ? `· 알레르기: ${recipe.allergens.join(', ')}` : ''}</p>
      {recipe.recipe?.length ? <ol>{recipe.recipe.map((s, i) => <li key={i} style={{ marginBottom: 6 }}>{s}</li>)}</ol> : <p className="muted">등록된 레시피가 없습니다.</p>}
      {recipe.description && <p>{recipe.description}</p>}
    </Modal>
  );
  const openRecipe = (it) => setRecipe(menuById.get(it.menu_item_id) || null);

  // ---------- 스테이션 선택 ----------
  if (!stationParam && !expoMode) {
    return (
      <div className="kds">
        {bar}
        <div className="station-pick">
          {stations.filter((s) => !s.is_expo).map((s) => (
            <button key={s.id} style={{ background: s.color }} onClick={() => choose({ station: String(s.id) })}>{s.name}</button>
          ))}
          <button style={{ background: '#374151' }} onClick={() => choose({ station: 'all' })}>전체 주방</button>
          <button style={{ background: '#7c3aed' }} onClick={() => choose({ view: 'expo' })}>패스 · 서빙</button>
        </div>
        {!stations.length && <div className="empty">등록된 스테이션이 없습니다. 관리 &gt; 주방 스테이션에서 등록하세요.</div>}
      </div>
    );
  }

  // ---------- 패스(Expo) ----------
  if (expoMode) {
    const live = orders.filter((o) => ACTIVE.includes(o.status))
      .sort((a, b) => (b.rush - a.rush) || new Date(a.created_at) - new Date(b.created_at));
    const cooking = live.filter((o) => o.status !== 'ready');
    const ready = live.filter((o) => o.status === 'ready').sort((a, b) => new Date(a.ready_at) - new Date(b.ready_at));
    const served = orders.filter((o) => o.status === 'served').sort((a, b) => new Date(b.served_at) - new Date(a.served_at)).slice(0, 10);
    const card = (o) => {
      const items = o.items.filter((i) => i.status !== 'cancelled');
      const done = items.filter(cooked).length;
      const isReady = o.status === 'ready';
      const wait = isReady ? elapsedSec(o.ready_at, now) : null;
      return (
        <TicketCard key={o.id} order={o} items={items} now={now} showStation onRecipe={openRecipe}
          progress={items.length ? done / items.length : 0}
          head={isReady ? { level: wait > 240 ? 'late' : wait > 120 ? 'warn' : 'ok', timer: `대기 ${mmss(wait)}` } : undefined}
          footer={(
            <>
              {isReady
                ? <button className="bump serve" onClick={() => act(`/orders/${o.id}/serve`)}>서빙 완료</button>
                : <button className="bump" disabled>{done}/{items.length} 조리중</button>}
              {can('order:manage') && (
                <button className="sub" onClick={() => act(`/orders/${o.id}/rush`, { rush: !o.rush })}>{o.rush ? '긴급해제' : '긴급'}</button>
              )}
              {!isReady && can('order:manage') && (
                <button className="sub" onClick={() => window.confirm('조리 미완료 상태로 서빙 처리할까요?') && act(`/orders/${o.id}/serve`, { force: true })}>강제서빙</button>
              )}
            </>
          )}
        />
      );
    };
    return (
      <div className="kds">
        {bar}
        <div className="expo-cols">
          <section className="expo-col">
            <h3>조리 중 ({cooking.length})</h3>
            <div className="kds-board">{cooking.map(card)}</div>
          </section>
          <section className="expo-col">
            <h3>서빙 대기 ({ready.length})</h3>
            <div className="kds-board">{ready.map(card)}</div>
          </section>
        </div>
        <div className="recall-strip">
          <span className="small" style={{ color: '#9ca3af' }}>최근 서빙 · 되돌리기</span>
          {served.map((o) => (
            <button key={o.id} className="chip" onClick={() => act(`/orders/${o.id}/unserve`)}>#{o.display_no}{o.table_no ? ` T${o.table_no}` : ''}</button>
          ))}
        </div>
        {recipeModal}
      </div>
    );
  }

  // ---------- 스테이션 ----------
  const forStation = (o) => o.items.filter((i) => i.status !== 'cancelled' && (stationId == null || i.station_id === stationId));
  const tickets = orders.filter((o) => ACTIVE.includes(o.status))
    .map((o) => ({ order: o, items: forStation(o) }))
    .filter((t) => t.items.some((i) => !cooked(i)))
    .sort((a, b) => (b.order.rush - a.order.rush) || new Date(a.order.created_at) - new Date(b.order.created_at));
  const recent = orders
    .map((o) => ({ order: o, items: forStation(o) }))
    .filter((t) => t.order.status !== 'cancelled' && t.items.length && t.items.every(cooked))
    .sort((a, b) => Math.max(...b.items.map((i) => +new Date(i.done_at))) - Math.max(...a.items.map((i) => +new Date(i.done_at))))
    .slice(0, 10);
  const pendingQty = tickets.reduce((s, t) => s + t.items.filter((i) => !cooked(i)).reduce((a, i) => a + i.qty - i.cancel_qty, 0), 0);

  return (
    <div className="kds">
      {bar}
      <div className="kds-bar" style={{ paddingTop: 4, paddingBottom: 4 }}>
        <span className="small">대기 티켓 <b>{tickets.length}</b> · 남은 수량 <b>{pendingQty}</b></span>
        <span className="small" style={{ color: '#9ca3af' }}>품목을 탭: 대기 → 조리중 → 호출(조리완료) · 호출 품목 탭 시 되돌리기</span>
      </div>
      <div className="kds-board">
        {tickets.map(({ order, items }) => (
          <TicketCard key={order.id} order={order} items={items} now={now} showStation={stationId == null}
            onRecipe={openRecipe}
            onItem={(it) => act(`/orders/items/${it.id}/${ITEM_NEXT[it.status]}`)}
            footer={<button className="bump" onClick={() => act(`/orders/${order.id}/bump`, { stationId })}>조리완료 · 호출</button>}
          />
        ))}
        {!tickets.length && <div className="empty" style={{ gridColumn: '1 / -1' }}>대기 중인 주문이 없습니다</div>}
      </div>
      <div className="recall-strip">
        <span className="small" style={{ color: '#9ca3af' }}>최근 완료 · 리콜</span>
        {recent.map(({ order }) => (
          <button key={order.id} className="chip" onClick={() => act(`/orders/${order.id}/recall`, { stationId })}>
            #{order.display_no}{order.table_no ? ` T${order.table_no}` : ''}
          </button>
        ))}
      </div>
      {recipeModal}
    </div>
  );
}
