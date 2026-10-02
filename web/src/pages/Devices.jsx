import { useState } from 'react';
import { patch, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { ErrorBox, Field, Modal, toastError, useForm } from '../components/ui.jsx';
import { dt } from '../format.js';

const TYPE = { printer_agent: '프린터 브릿지 에이전트', pos: 'POS API 연동', kds: 'KDS 단말' };

export default function Devices() {
  const { storeId, store } = useAuth();
  const { data, error, reload } = useApi(`/stores/${storeId}/devices`);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState(null);
  const { values, bind, setValues } = useForm({ name: '', type: 'printer_agent' });

  const create = async () => {
    try {
      const d = await post(`/stores/${storeId}/devices`, values);
      setCreated(d); setAdding(false); setValues({ name: '', type: 'printer_agent' }); reload();
    } catch (e) { toastError(e); }
  };
  const toggle = async (d) => {
    try { await patch(`/stores/${storeId}/devices/${d.id}`, { active: !d.active }); reload(); } catch (e) { toastError(e); }
  };
  const origin = window.location.origin;

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>POS · 프린터 연결 · {store?.name}</h1>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setAdding(true)}>연결 키 발급</button>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>연동 방식</h3>
        <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li><b>프린터 브릿지(권장, POS 무수정)</b>: 매장 PC에서 <code>mps-printer-agent</code> 실행 → POS의 주방프린터 IP를 해당 PC(9100 포트)로 변경. 에이전트가 전표를 MPS로 보내고 실제 프린터로도 그대로 출력(백업)합니다.</li>
          <li><b>POS API 연동</b>: POS사가 <code>POST /api/pos/orders</code> 로 주문 JSON 전송 (헤더 <code>X-Device-Key</code>).</li>
        </ol>
      </div>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>이름</th><th>유형</th><th>키</th><th>최근 통신</th><th>상태</th><th /></tr></thead>
          <tbody>
            {data?.map((d) => (
              <tr key={d.id} className={d.active ? '' : 'off'}>
                <td>{d.name}</td><td>{TYPE[d.type]}</td><td className="small">{d.key_prefix}…</td>
                <td>{dt(d.last_seen_at)}</td>
                <td>{d.active ? <span className="badge ok">사용</span> : <span className="badge">중지</span>}</td>
                <td><button className="btn sm" onClick={() => toggle(d)}>{d.active ? '중지' : '재사용'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.length && <div className="empty">발급된 연결 키가 없습니다</div>}
      </div>

      {adding && (
        <Modal title="연결 키 발급" onClose={() => setAdding(false)}
          footer={<><button className="btn" onClick={() => setAdding(false)}>취소</button><button className="btn primary" onClick={create} disabled={!values.name}>발급</button></>}>
          <Field label="이름"><input className="input" placeholder="예: 카운터 POS 주방프린터" {...bind('name')} /></Field>
          <Field label="유형">
            <select className="input" {...bind('type')}>
              {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </Modal>
      )}
      {created && (
        <Modal title="연결 키가 발급되었습니다" onClose={() => setCreated(null)} wide
          footer={<button className="btn primary" onClick={() => setCreated(null)}>확인</button>}>
          <p className="error">이 키는 지금 한 번만 표시됩니다. 안전한 곳에 보관하세요.</p>
          <pre className="code">{created.key}</pre>
          {created.type === 'printer_agent' && (
            <>
              <h3>매장 PC 에이전트 실행 예시</h3>
              <pre className="code">{`MPS_SERVER=${origin} \\
MPS_DEVICE_KEY=${created.key} \\
LISTEN_PORT=9100 \\
FORWARD_PRINTER=192.168.0.50:9100 \\
node printer-agent.js`}</pre>
            </>
          )}
          {created.type === 'pos' && (
            <>
              <h3>POS 주문 전송 예시</h3>
              <pre className="code">{`curl -X POST ${origin}/api/pos/orders \\
  -H "Content-Type: application/json" -H "X-Device-Key: ${created.key}" \\
  -d '{"externalId":"POS-20261002-0001","tableNo":"5","items":[{"code":"M003","name":"된장찌개","qty":1}]}'`}</pre>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
