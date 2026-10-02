import { useState } from 'react';
import { post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { useStoreSocket } from '../socket.js';
import { ErrorBox, Modal, toast, toastError } from '../components/ui.jsx';
import { ITEM_STATUS, ORDER_STATUS, ORDER_TYPE, mmss, time, today } from '../format.js';

const TONE = { received: 'info', cooking: 'warn', ready: 'ok', served: '', cancelled: 'danger' };

export default function Orders() {
  const { storeId, can } = useAuth();
  const [date, setDate] = useState(today());
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState(null);
  const { data, error, reload } = useApi(`/stores/${storeId}/orders?scope=all&date=${date}`);
  useStoreSocket(storeId, { 'order:created': reload, 'order:updated': reload });

  const rows = (data || []).filter((o) => !status || o.status === status).slice().reverse();
  const act = async (path, body, msg) => {
    try { const o = await post(path, body); setDetail(o); toast(msg); reload(); } catch (e) { toastError(e); }
  };
  const secs = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 1000 : null);

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>주문 현황</h1>
        <div className="spacer" />
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 'auto' }} />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
          <option value="">전체 상태</option>
          {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>번호</th><th>접수</th><th>테이블/유형</th><th>메뉴</th><th>상태</th><th>조리완료</th><th>서빙</th><th>경로</th></tr></thead>
          <tbody>
            {rows.map((o) => {
              const cook = secs(o.created_at, o.ready_at);
              const late = cook != null && cook > o.target_minutes * 60;
              return (
                <tr key={o.id} onClick={() => setDetail(o)} style={{ cursor: 'pointer' }}>
                  <td><b>#{o.display_no}</b>{o.rush && <span className="badge late" style={{ marginLeft: 4 }}>긴급</span>}</td>
                  <td>{time(o.created_at)}</td>
                  <td>{o.table_no ? `T${o.table_no} · ` : ''}{ORDER_TYPE[o.order_type]}</td>
                  <td className="small">{o.items.map((i) => `${i.name}×${i.qty}`).join(', ')}</td>
                  <td><span className={`badge ${TONE[o.status]}`}>{ORDER_STATUS[o.status]}</span></td>
                  <td><span className={late ? 'badge late' : ''}>{mmss(cook)}</span> <span className="small muted">/ {o.target_minutes}분</span></td>
                  <td>{mmss(secs(o.ready_at, o.served_at))}</td>
                  <td className="small">{o.source}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <div className="empty">주문이 없습니다</div>}
      </div>

      {detail && (
        <Modal title={`주문 #${detail.display_no}`} onClose={() => setDetail(null)} wide
          footer={(
            <>
              {can('order:manage') && ['received', 'cooking', 'ready'].includes(detail.status) && (
                <>
                  <button className="btn" onClick={() => act(`/orders/${detail.id}/rush`, { rush: !detail.rush }, '변경되었습니다')}>{detail.rush ? '긴급 해제' : '긴급 지정'}</button>
                  <button className="btn danger" onClick={() => window.confirm('주문을 취소할까요?') && act(`/orders/${detail.id}/cancel`, {}, '취소되었습니다')}>주문 취소</button>
                </>
              )}
              <button className="btn" onClick={() => setDetail(null)}>닫기</button>
            </>
          )}>
          <p className="muted">
            {ORDER_TYPE[detail.order_type]} {detail.table_no && `· 테이블 ${detail.table_no}`} · {ORDER_STATUS[detail.status]} · 접수 {time(detail.created_at)}
            {detail.pos_order_no && ` · POS ${detail.pos_order_no}`}
          </p>
          <table className="table">
            <thead><tr><th>메뉴</th><th>수량</th><th>스테이션</th><th>상태</th><th>조리시간</th></tr></thead>
            <tbody>
              {detail.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}{i.options && <div className="small muted">└ {i.options}</div>}</td>
                  <td>{i.qty}</td>
                  <td><span className="swatch" style={{ background: i.station_color }} />{i.station_name}</td>
                  <td>{ITEM_STATUS[i.status]}</td>
                  <td>{mmss(secs(detail.created_at, i.done_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.memo && <p>📝 {detail.memo}</p>}
          {detail.raw_ticket && (<><h3 style={{ marginTop: 12 }}>프린터 원문</h3><pre className="code">{detail.raw_ticket}</pre></>)}
        </Modal>
      )}
    </div>
  );
}
