import { post } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, toast, toastError, useForm } from '../components/ui.jsx';
import { ROLE_LABEL } from '../format.js';

export default function Account() {
  const { user, me } = useAuth();
  const { values, bind, setValues } = useForm({ current: '', next: '', confirm: '' });
  const save = async () => {
    if (values.next !== values.confirm) return toastError(new Error('새 비밀번호가 일치하지 않습니다'));
    try {
      await post('/auth/password', { current: values.current, next: values.next });
      toast('비밀번호가 변경되었습니다');
      setValues({ current: '', next: '', confirm: '' });
    } catch (e) { toastError(e); }
  };
  return (
    <div style={{ maxWidth: 520 }}>
      <h1>내 계정</h1>
      <div className="card" style={{ marginBottom: 16 }}>
        <p><b>{user.name}</b> ({user.loginId}) · {ROLE_LABEL[user.role]} · {user.orgName}</p>
        <div className="small muted">권한: {me.permissions.join(', ')}</div>
      </div>
      <div className="card">
        <h3>비밀번호 변경</h3>
        <Field label="현재 비밀번호"><input className="input" type="password" {...bind('current')} /></Field>
        <Field label="새 비밀번호 (6자 이상)"><input className="input" type="password" {...bind('next')} /></Field>
        <Field label="새 비밀번호 확인"><input className="input" type="password" {...bind('confirm')} /></Field>
        <button className="btn primary" onClick={save}>변경</button>
      </div>
    </div>
  );
}
