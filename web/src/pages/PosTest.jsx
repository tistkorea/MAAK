// POS 연동 테스트: (1) POS 주문 시뮬레이터  (2) 주방프린터 전표 파싱 테스트
import { useState } from 'react';
import { post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { ErrorBox, toast, toastError } from '../components/ui.jsx';
import { ORDER_TYPE, won } from '../format.js';

const SAMPLE = `[주방주문서]
테이블: 8   주문번호: 1024
2026-10-02 12:31
----------------------------
메뉴명              수량
산채비빔밥            2
  - 계란 빼고
된장찌개              1
제육                  1
막걸리               x2
----------------------------
요청: 아이 동반, 앞접시 2개`;

export default function PosTest() {
  const { storeId } = useAuth();
  const [tab, setTab] = useState('pos');
  return (
    <div>
      <h1>POS 연동 · 테스트</h1>
      <div className="tabs">
        <button className={tab === 'pos' ? 'on' : ''} onClick={() => setTab('pos')}>POS 주문 시뮬레이터</button>
        <button className={tab === 'print' ? 'on' : ''} onClick={() => setTab('print')}>주방프린터 전표 테스트</button>
      </div>
      {tab === 'pos' ? <PosSimulator storeId={storeId} /> : <PrintTest storeId={storeId} />}
    </div>
  );
}

function PosSimulator({ storeId }) {
  const { data: menu } = useApi(`/stores/${storeId}/menu`);
  const [cart, setCart] = useState([]);
  const [tableNo, setTableNo] = useState('');
  const [guests, setGuests] = useState('2');
  const [channel, setChannel] = useState('pos');
  const [orderType, setOrderType] = useState('dine_in');
  const [memo, setMemo] = useState('');
  const [rush, setRush] = useState(false);

  const add = (m) => setCart((c) => {
    const i = c.findIndex((x) => x.menuItemId === m.id && !x.options);
    if (i >= 0) { const n = [...c]; n[i] = { ...n[i], qty: n[i].qty + 1 }; return n; }
    return [...c, { menuItemId: m.id, name: m.name, qty: 1, options: '', price: m.price }];
  });
  const update = (idx, patch) => setCart((c) => c.map((x, i) => (i === idx ? { ...x, ...patch } : x)).filter((x) => x.qty > 0));
  const submit = async () => {
    try {
      const o = await post(`/stores/${storeId}/orders`, {
        tableNo: tableNo || null, orderType, memo: memo || null, rush, channel,
        guestCount: orderType === 'dine_in' && Number(guests) > 0 ? Number(guests) : null,
        items: cart.map(({ menuItemId, name, qty, options }) => ({ menuItemId, name, qty, options: options || null })),
      });
      toast(`주문 #${o.display_no} 전송 → 주방 ${new Set(o.items.map((i) => i.station_name)).size}개 파트`);
      setCart([]); setMemo(''); setRush(false);
    } catch (e) { toastError(e); }
  };
  const groups = (menu || []).reduce((acc, m) => { (acc[m.category_name || '기타'] ||= []).push(m); return acc; }, {});

  return (
    <div className="grid2" style={{ gridTemplateColumns: '2fr 1fr', alignItems: 'start' }}>
      <div>
        {Object.entries(groups).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 14 }}>
            <h3>{cat}</h3>
            <div className="pos-menu">
              {items.map((m) => (
                <button key={m.id} className={m.sold_out ? 'soldout' : ''} onClick={() => add(m)} title={m.sold_out ? '품절' : ''}>
                  <div><b>{m.name}</b></div>
                  <div className="small muted">{won(m.price)}{m.sold_out ? ' · 품절' : ''}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>주문서</h3>
        <div className="grid2">
          <label className="field">테이블<input className="input" value={tableNo} onChange={(e) => setTableNo(e.target.value)} /></label>
          <label className="field">인원<input className="input" type="number" min="1" value={guests} onChange={(e) => setGuests(e.target.value)} /></label>
          <label className="field">유입경로
            <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="pos">POS</option><option value="table_order">테이블오더</option><option value="manual">수동</option>
            </select>
          </label>
          <label className="field">유형
            <select className="input" value={orderType} onChange={(e) => setOrderType(e.target.value)}>
              <option value="dine_in">매장</option><option value="takeout">포장</option><option value="delivery">배달</option>
            </select>
          </label>
        </div>
        {cart.map((c, i) => (
          <div key={i} style={{ borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
            <div className="row">
              <b>{c.name}</b><span className="spacer" />
              <button className="btn sm" onClick={() => update(i, { qty: c.qty - 1 })}>−</button>
              <b>{c.qty}</b>
              <button className="btn sm" onClick={() => update(i, { qty: c.qty + 1 })}>+</button>
            </div>
            <input className="input" placeholder="옵션 (예: 덜맵게)" value={c.options} onChange={(e) => update(i, { options: e.target.value })} style={{ marginTop: 4 }} />
          </div>
        ))}
        {!cart.length && <p className="muted small">메뉴를 눌러 담으세요</p>}
        <label className="field" style={{ marginTop: 8 }}>요청사항<input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={rush} onChange={(e) => setRush(e.target.checked)} /> 긴급</label>
        <div className="row" style={{ marginTop: 8 }}>
          <b>{won(cart.reduce((s, c) => s + c.price * c.qty, 0))}</b>
          <span className="spacer" />
          <button className="btn primary" disabled={!cart.length} onClick={submit}>주방 전송</button>
        </div>
      </div>
    </div>
  );
}

function PrintTest({ storeId }) {
  const [text, setText] = useState(SAMPLE);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const run = async (commit) => {
    setError(null);
    try {
      const r = await post(`/stores/${storeId}/print-test`, { text, commit });
      setResult(r);
      if (commit) toast(r.action === 'created' ? `주문 #${r.order.display_no} 생성` : `처리 결과: ${r.action} ${r.reason || ''}`);
    } catch (e) { setError(e); }
  };
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div>
        <p className="muted small">POS가 주방프린터로 출력하는 전표 내용을 붙여넣어 MPS 파서가 어떻게 해석하는지 확인합니다. 실제 매장에서는 프린터 브릿지 에이전트가 원본(ESC/POS)을 자동 전송합니다.</p>
        <textarea className="input" style={{ minHeight: 320, fontFamily: 'monospace' }} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => run(false)}>파싱 미리보기</button>
          <button className="btn primary" onClick={() => run(true)}>주문으로 전송</button>
        </div>
        <ErrorBox error={error} />
      </div>
      <div className="card">
        <h3>파싱 결과</h3>
        {!result && <p className="muted">미리보기를 실행하세요</p>}
        {result && (
          <>
            <p className="small">테이블 <b>{result.parsed.tableNo || '-'}</b> · 주문번호 <b>{result.parsed.posOrderNo || '-'}</b> · 유형 <b>{ORDER_TYPE[result.parsed.orderType]}</b>
              {result.parsed.isCancel && <span className="badge late"> 취소전표</span>}{result.parsed.rush && <span className="badge late"> 긴급</span>}</p>
            <table className="table">
              <thead><tr><th>메뉴</th><th>수량</th><th>옵션</th></tr></thead>
              <tbody>{result.parsed.items.map((i, k) => <tr key={k}><td>{i.name}</td><td>{i.qty}</td><td>{i.options}</td></tr>)}</tbody>
            </table>
            {!!result.parsed.memo.length && <p className="small">요청: {result.parsed.memo.join(' / ')}</p>}
            {!!result.parsed.unparsed.length && <p className="small" style={{ color: 'var(--warn)' }}>미확인 라인(메모로 전달): {result.parsed.unparsed.join(' / ')}</p>}
          </>
        )}
      </div>
    </div>
  );
}
