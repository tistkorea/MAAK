import { useState } from 'react';
import { patch, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { ErrorBox, Field, Modal, toast, toastError, useForm } from '../components/ui.jsx';
import { STATION_TYPES } from '../format.js';

const typeLabel = Object.fromEntries(STATION_TYPES);

export default function Stations() {
  const { storeId, store } = useAuth();
  const { data, error, reload } = useApi(`/stores/${storeId}/stations`);
  const [edit, setEdit] = useState(null);

  const remove = async (s) => {
    if (!window.confirm(`'${s.name}' 스테이션을 비활성화할까요? 신규 주문은 다른 스테이션으로 라우팅됩니다.`)) return;
    try { await patch(`/stores/${storeId}/stations/${s.id}`, { active: false }); reload(); } catch (e) { toastError(e); }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>주방 스테이션 · {store?.name}</h1>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setEdit({})}>스테이션 추가</button>
      </div>
      <p className="muted small">메뉴는 본부가 지정한 <b>조리 파트 유형</b>과 같은 유형의 스테이션으로 자동 전송됩니다. 일치하는 스테이션이 없으면 <b>기본 스테이션</b>으로 갑니다. 패스(서빙) 스테이션은 조리 품목을 받지 않고 주문 전체를 모아 서빙을 처리합니다.</p>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>순서</th><th>이름</th><th>조리 파트 유형</th><th>구분</th><th /></tr></thead>
          <tbody>
            {data?.map((s) => (
              <tr key={s.id}>
                <td>{s.sort_order}</td>
                <td><span className="swatch" style={{ background: s.color }} />{s.name}</td>
                <td>{typeLabel[s.type] || s.type} <span className="small muted">({s.type})</span></td>
                <td>{s.is_expo && <span className="badge info">패스</span>} {s.is_default && <span className="badge ok">기본</span>}</td>
                <td className="row">
                  <button className="btn sm" onClick={() => setEdit(s)}>수정</button>
                  <button className="btn sm" onClick={() => remove(s)}>비활성화</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <StationForm storeId={storeId} station={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function StationForm({ storeId, station, onClose, onSaved }) {
  const { values, bind } = useForm({
    name: station.name || '', type: station.type || 'main', color: station.color || '#3b82f6',
    isExpo: station.is_expo || false, isDefault: station.is_default || false, sortOrder: station.sort_order ?? 0,
  });
  const save = async () => {
    try {
      const body = { ...values, sortOrder: Number(values.sortOrder) || 0 };
      if (station.id) await patch(`/stores/${storeId}/stations/${station.id}`, body);
      else await post(`/stores/${storeId}/stations`, body);
      toast('저장되었습니다');
      onSaved();
    } catch (e) { toastError(e); }
  };
  return (
    <Modal title={station.id ? '스테이션 수정' : '스테이션 추가'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>취소</button><button className="btn primary" onClick={save}>저장</button></>}>
      <Field label="이름"><input className="input" {...bind('name')} /></Field>
      <div className="grid2">
        <Field label="조리 파트 유형">
          <select className="input" {...bind('type')}>
            {STATION_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="색상"><input className="input" type="color" {...bind('color')} style={{ height: 38 }} /></Field>
      </div>
      <Field label="표시 순서"><input className="input" type="number" {...bind('sortOrder')} /></Field>
      <label className="check"><input type="checkbox" {...bind('isExpo', 'checkbox')} /> 패스(서빙) 스테이션</label>
      <label className="check"><input type="checkbox" {...bind('isDefault', 'checkbox')} /> 기본 스테이션 (미지정 메뉴 수신)</label>
    </Modal>
  );
}
