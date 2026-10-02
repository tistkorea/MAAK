import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { ErrorBox } from '../components/ui.jsx';

const DEMO = [
  ['dev', 'dev1234', '개발팀'], ['hq', 'hq1234', '가맹본부'], ['branch', 'branch1234', '가맹지점'],
  ['owner', 'owner1234', '가맹점(점주)'], ['manager', 'manager1234', '매니저'], ['staff', 'staff1234', '스텝'],
];

export default function Login() {
  const { login } = useAuth();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e, id = loginId, pw = password) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try { await login(id, pw); } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <h1 style={{ marginBottom: 4 }}>MPS</h1>
        <div className="muted small" style={{ marginBottom: 16 }}>Menu Portal Solution · Kitchen Control System</div>
        <label className="field">아이디<input className="input" value={loginId} onChange={(e) => setLoginId(e.target.value)} autoFocus autoComplete="username" /></label>
        <label className="field">비밀번호<input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        <ErrorBox error={error} />
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>로그인</button>
        {(import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO === '1') && (
          <>
            <div className="small muted" style={{ marginTop: 16 }}>데모 계정 (개발 모드)</div>
            <div className="demo-accounts">
              {DEMO.map(([id, pw, label]) => (
                <button type="button" key={id} className="btn sm" onClick={() => submit(null, id, pw)}>{label} · {id}</button>
              ))}
            </div>
          </>
        )}
      </form>
    </div>
  );
}
