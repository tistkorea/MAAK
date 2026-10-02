import { useMemo, useState } from 'react';
import { patch, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { ErrorBox, Field, Modal, toast, toastError, useForm } from '../components/ui.jsx';
import { ORG_TYPE } from '../format.js';

const CHILD = { platform: ['hq'], hq: ['branch', 'store'], branch: ['store'], store: [] };
const STATUS = { active: ['운영', 'ok'], suspended: ['중지', 'warn'], closed: ['폐점', 'danger'] };

export default function Orgs() {
  const { user, can, refresh } = useAuth();
  const { data, error, reload } = useApi('/orgs');
  const [form, setForm] = useState(null); // { parent } | { org }

  const children = useMemo(() => {
    const m = new Map();
    for (const o of data || []) {
      if (!m.has(o.parent_id)) m.set(o.parent_id, []);
      m.get(o.parent_id).push(o);
    }
    return m;
  }, [data]);
  const root = data?.find((o) => o.id === user.orgId);

  const canCreate = (o) => can('org:manage') && CHILD[o.type].some((t) => t !== 'hq' || user.role === 'developer');

  const Node = ({ org }) => (
    <li>
      <div className="node">
        <span className="badge info">{ORG_TYPE[org.type]}</span>
        <b>{org.name}</b>
        {org.code && <span className="small muted">{org.code}</span>}
        <span className={`badge ${STATUS[org.status][1]}`}>{STATUS[org.status][0]}</span>
        <span className="small muted">사용자 {org.user_count}</span>
        <span className="spacer" />
        {canCreate(org) && <button className="btn sm" onClick={() => setForm({ parent: org })}>+ 하위 조직</button>}
        {can('org:manage') && <button className="btn sm" onClick={() => setForm({ org })}>수정</button>}
      </div>
      {children.get(org.id)?.length > 0 && (
        <ul className="tree">{children.get(org.id).map((c) => <Node key={c.id} org={c} />)}</ul>
      )}
    </li>
  );

  return (
    <div>
      <h1>조직 관리</h1>
      <p className="muted small">개발팀 → 가맹본부 → 가맹지점(지사) → 가맹점 계층으로 운영됩니다. 상위 조직은 하위 조직의 메뉴·주방 운영·품질 데이터를 관리·조회합니다.</p>
      <ErrorBox error={error} />
      <div className="card">{root && <ul className="tree root"><Node org={root} /></ul>}</div>
      {form && (
        <OrgForm {...form} onClose={() => setForm(null)}
          onSaved={() => { setForm(null); reload(); refresh(); }} isDev={user.role === 'developer'} />
      )}
    </div>
  );
}

function OrgForm({ parent, org, onClose, onSaved, isDev }) {
  const types = parent ? CHILD[parent.type].filter((t) => t !== 'hq' || isDev) : [];
  const { values, bind } = useForm({
    type: types[types.length - 1] || 'store',
    name: org?.name || '', code: org?.code || '', address: org?.address || '', phone: org?.phone || '',
    status: org?.status || 'active',
  });
  const save = async () => {
    try {
      if (org) {
        await patch(`/orgs/${org.id}`, { name: values.name, code: values.code || null, address: values.address || null, phone: values.phone || null, status: values.status });
      } else {
        await post('/orgs', { parentId: parent.id, type: values.type, name: values.name, code: values.code || null, address: values.address || null, phone: values.phone || null });
      }
      toast('저장되었습니다');
      onSaved();
    } catch (e) { toastError(e); }
  };
  return (
    <Modal title={org ? `${org.name} 수정` : `${parent.name} 하위 조직 추가`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>취소</button><button className="btn primary" onClick={save} disabled={!values.name}>저장</button></>}>
      {!org && (
        <Field label="유형">
          <select className="input" {...bind('type')}>{types.map((t) => <option key={t} value={t}>{ORG_TYPE[t]}</option>)}</select>
        </Field>
      )}
      <div className="grid2">
        <Field label="이름"><input className="input" {...bind('name')} /></Field>
        <Field label="코드"><input className="input" {...bind('code')} /></Field>
      </div>
      <Field label="주소"><input className="input" {...bind('address')} /></Field>
      <div className="grid2">
        <Field label="전화"><input className="input" {...bind('phone')} /></Field>
        {org && (
          <Field label="운영 상태">
            <select className="input" {...bind('status')}>
              {Object.entries(STATUS).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        )}
      </div>
      {!org && values.type === 'store' && <p className="small muted">매장 생성 후 '주방 스테이션'을 등록하고 점주 계정을 발급하세요.</p>}
    </Modal>
  );
}
