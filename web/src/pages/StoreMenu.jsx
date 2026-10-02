import { put } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { useStoreSocket } from '../socket.js';
import { ErrorBox, toastError } from '../components/ui.jsx';
import { won } from '../format.js';

export default function StoreMenu() {
  const { storeId, store } = useAuth();
  const { data: menu, error, reload } = useApi(`/stores/${storeId}/menu`);
  const { data: stations } = useApi(`/stores/${storeId}/stations`);
  useStoreSocket(storeId, { 'menu:changed': reload });
  const cooking = (stations || []).filter((s) => !s.is_expo);
  const auto = (m) => cooking.find((s) => s.type === m.station_type) || cooking.find((s) => s.is_default) || cooking[0];

  const save = async (m, body) => {
    try { await put(`/stores/${storeId}/menu/${m.id}`, body); reload(); } catch (e) { toastError(e); }
  };

  return (
    <div>
      <h1>매장 메뉴 운영 · {store?.name}</h1>
      <p className="muted small">본부 마스터 메뉴를 기준으로 매장별 <b>품절</b>, <b>조리 스테이션 재지정</b>, <b>판매가</b>를 운영합니다. 스테이션을 비워두면 본부가 정한 조리 파트 유형에 따라 자동 배정됩니다.</p>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>분류</th><th>코드</th><th>메뉴</th><th>표준시간</th><th>조리 스테이션</th><th>판매가</th><th>품절</th></tr></thead>
          <tbody>
            {menu?.map((m) => (
              <tr key={m.id} className={m.sold_out ? 'off' : ''}>
                <td className="small">{m.category_name}</td>
                <td className="small">{m.code}</td>
                <td><b>{m.name}</b></td>
                <td>{m.target_minutes}분</td>
                <td>
                  <select className="input" value={m.station_override ?? ''} onChange={(e) => save(m, { stationId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">자동 ({auto(m)?.name || '-'})</option>
                    {cooking.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
                <td>
                  <input key={`${m.id}-${m.price}`} className="input" type="number" defaultValue={m.price} style={{ width: 110 }}
                    onBlur={(e) => Number(e.target.value) !== m.price && save(m, { price: e.target.value === '' ? null : Number(e.target.value) })} />
                  {m.price !== m.base_price && <div className="small muted">본부가 {won(m.base_price)}</div>}
                </td>
                <td>
                  <button className={`btn sm ${m.sold_out ? 'danger' : ''}`} onClick={() => save(m, { soldOut: !m.sold_out })}>
                    {m.sold_out ? '품절' : '판매중'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
