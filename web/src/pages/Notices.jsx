import { useState } from 'react';
import { del, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { ErrorBox, Field, Modal, toast, toastError, useForm } from '../components/ui.jsx';
import { ORG_TYPE, dt } from '../format.js';

export default function Notices() {
  const { user, can } = useAuth();
  const { data, error, reload } = useApi('/notices');
  const { data: orgs } = useApi(can('notice:publish') && can('org:view') ? '/orgs' : null);
  const [adding, setAdding] = useState(false);
  const { values, bind, setValues } = useForm({ orgId: user.orgId, title: '', body: '', pinned: false });

  const create = async () => {
    try {
      await post('/notices', { ...values, orgId: Number(values.orgId) });
      toast('공지가 발행되었습니다 · 하위 조직 전체에 표시');
      setAdding(false); setValues({ orgId: user.orgId, title: '', body: '', pinned: false }); reload();
    } catch (e) { toastError(e); }
  };
  const remove = async (n) => {
    if (!window.confirm('삭제할까요?')) return;
    try { await del(`/notices/${n.id}`); reload(); } catch (e) { toastError(e); }
  };
  const mine = (n) => can('notice:publish') && (orgs || []).some((o) => o.id === n.org_id);

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>공지사항</h1>
        <div className="spacer" />
        {can('notice:publish') && <button className="btn primary" onClick={() => setAdding(true)}>공지 작성</button>}
      </div>
      <ErrorBox error={error} />
      {data?.map((n) => (
        <div key={n.id} className="card" style={{ marginBottom: 10 }}>
          <div className="row">
            {n.pinned && <span className="badge warn">고정</span>}
            <h3 style={{ margin: 0 }}>{n.title}</h3>
            <span className="spacer" />
            <span className="small muted">{ORG_TYPE[n.org_type]} {n.org_name} · {n.author_name || '시스템'} · {dt(n.created_at)}</span>
            {mine(n) && <button className="btn sm" onClick={() => remove(n)}>삭제</button>}
          </div>
          <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{n.body}</p>
        </div>
      ))}
      {!data?.length && <div className="empty">공지가 없습니다</div>}
      {adding && (
        <Modal title="공지 작성" onClose={() => setAdding(false)}
          footer={<><button className="btn" onClick={() => setAdding(false)}>취소</button><button className="btn primary" onClick={create} disabled={!values.title || !values.body}>발행</button></>}>
          {orgs && (
            <Field label="발행 조직 (하위 조직 전체에 노출)">
              <select className="input" {...bind('orgId')}>
                {orgs.filter((o) => o.type !== 'store' || user.orgType === 'store').map((o) => <option key={o.id} value={o.id}>{ORG_TYPE[o.type]} · {o.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="제목"><input className="input" {...bind('title')} /></Field>
          <Field label="내용"><textarea className="input" {...bind('body')} /></Field>
          <label className="check"><input type="checkbox" {...bind('pinned', 'checkbox')} /> 상단 고정</label>
        </Modal>
      )}
    </div>
  );
}
