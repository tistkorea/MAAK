import { useState } from 'react';
import { patch, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { ErrorBox, Field, Modal, toast, toastError, useForm } from '../components/ui.jsx';
import { ORG_TYPE, ROLE_LABEL, ROLE_LEVEL, ROLE_ORG, dt } from '../format.js';

export default function Users() {
  const { user, can } = useAuth();
  const { data, error, reload } = useApi('/users');
  const { data: orgsData } = useApi(can('org:view') ? '/orgs' : null);
  const orgs = orgsData || [{ id: user.orgId, name: user.orgName, type: user.orgType }];
  const [form, setForm] = useState(null);
  const manageable = (u) => u.id !== user.id && (user.role === 'developer' || ROLE_LEVEL[u.role] < ROLE_LEVEL[user.role]);

  const toggle = async (u) => {
    try { await patch(`/users/${u.id}`, { active: !u.active }); reload(); } catch (e) { toastError(e); }
  };
  const resetPw = async (u) => {
    const pw = window.prompt(`${u.name}님의 새 비밀번호 (6자 이상)`);
    if (!pw) return;
    try { await patch(`/users/${u.id}`, { password: pw }); toast('비밀번호가 변경되었습니다'); } catch (e) { toastError(e); }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>사용자 · 권한</h1>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setForm({})}>사용자 추가</button>
      </div>
      <p className="muted small">본인보다 낮은 역할만 생성·관리할 수 있습니다. 개발팀 &gt; 가맹본부 &gt; 가맹지점 &gt; 가맹점(점주) &gt; 매니저 &gt; 스텝</p>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>이름</th><th>아이디</th><th>역할</th><th>소속</th><th>최근 로그인</th><th>상태</th><th /></tr></thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'off'}>
                <td><b>{u.name}</b></td><td>{u.login_id}</td>
                <td><span className="badge info">{ROLE_LABEL[u.role]}</span></td>
                <td className="small">{ORG_TYPE[u.org_type]} · {u.org_name}</td>
                <td className="small">{dt(u.last_login_at)}</td>
                <td>{u.active ? <span className="badge ok">사용</span> : <span className="badge">중지</span>}</td>
                <td className="row">
                  {manageable(u) && (
                    <>
                      <button className="btn sm" onClick={() => setForm({ user: u })}>수정</button>
                      <button className="btn sm" onClick={() => resetPw(u)}>비밀번호</button>
                      <button className="btn sm" onClick={() => toggle(u)}>{u.active ? '중지' : '재사용'}</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && <UserForm {...form} me={user} orgs={orgs} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
    </div>
  );
}

function UserForm({ user: target, me, orgs, onClose, onSaved }) {
  const assignable = Object.keys(ROLE_LABEL).filter((r) => me.role === 'developer' || ROLE_LEVEL[r] < ROLE_LEVEL[me.role]);
  const { values, bind } = useForm({
    orgId: target?.org_id ?? orgs.find((o) => assignable.some((r) => ROLE_ORG[r] === o.type))?.id ?? '',
    role: target?.role ?? '', loginId: '', password: '', name: target?.name ?? '', phone: target?.phone ?? '',
  });
  const org = orgs.find((o) => o.id === Number(values.orgId));
  const roles = assignable.filter((r) => ROLE_ORG[r] === (org?.type || target?.org_type));
  const role = roles.includes(values.role) ? values.role : roles[0];

  const save = async () => {
    try {
      if (target) await patch(`/users/${target.id}`, { name: values.name, phone: values.phone || null, role });
      else await post('/users', { orgId: Number(values.orgId), role, loginId: values.loginId, password: values.password, name: values.name, phone: values.phone || null });
      toast('저장되었습니다');
      onSaved();
    } catch (e) { toastError(e); }
  };

  return (
    <Modal title={target ? `${target.name} 수정` : '사용자 추가'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>취소</button><button className="btn primary" onClick={save} disabled={!role}>저장</button></>}>
      {!target && (
        <Field label="소속 조직">
          <select className="input" {...bind('orgId')}>
            {orgs.filter((o) => assignable.some((r) => ROLE_ORG[r] === o.type)).map((o) => (
              <option key={o.id} value={o.id}>{ORG_TYPE[o.type]} · {o.name}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label="역할">
        <select className="input" value={role || ''} onChange={bind('role').onChange}>
          {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </Field>
      {!target && (
        <div className="grid2">
          <Field label="아이디"><input className="input" {...bind('loginId')} autoComplete="off" /></Field>
          <Field label="초기 비밀번호"><input className="input" type="password" {...bind('password')} autoComplete="new-password" /></Field>
        </div>
      )}
      <div className="grid2">
        <Field label="이름"><input className="input" {...bind('name')} /></Field>
        <Field label="연락처"><input className="input" {...bind('phone')} /></Field>
      </div>
      {!roles.length && <ErrorBox error={new Error('이 조직에 부여할 수 있는 역할이 없습니다')} />}
    </Modal>
  );
}
