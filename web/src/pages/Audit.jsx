import { useApi } from '../hooks.js';
import { ErrorBox } from '../components/ui.jsx';
import { dt } from '../format.js';

export default function Audit() {
  const { data, error } = useApi('/audit-logs?limit=300');
  return (
    <div>
      <h1>감사 로그</h1>
      <p className="muted small">로그인, 조직·사용자·메뉴·스테이션 변경, 주문 취소/강제서빙 등 주요 운영 행위 기록입니다.</p>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>시각</th><th>사용자</th><th>조직</th><th>행위</th><th>대상</th><th>상세</th><th>IP</th></tr></thead>
          <tbody>
            {data?.map((a) => (
              <tr key={a.id}>
                <td className="small">{dt(a.created_at)}</td>
                <td>{a.user_name || '-'} <span className="small muted">{a.login_id}</span></td>
                <td className="small">{a.org_name}</td>
                <td><code>{a.action}</code></td>
                <td className="small">{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td>
                <td className="small" style={{ maxWidth: 320, wordBreak: 'break-all' }}>{a.detail ? JSON.stringify(a.detail) : ''}</td>
                <td className="small">{a.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
