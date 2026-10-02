import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { ROLE_LABEL } from '../format.js';

export const NAV = [
  { group: '주방 운영', items: [
    { to: '/kds', label: 'KDS 주방화면', perm: 'kds:operate', store: true },
    { to: '/kds?view=expo', label: '패스 · 서빙', perm: 'kds:operate', store: true },
    { to: '/orders', label: '주문 현황', perm: 'kds:operate', store: true },
    { to: '/pos-test', label: 'POS 연동 · 테스트', perm: 'order:create', store: true },
  ] },
  { group: '매장 관리', items: [
    { to: '/stations', label: '주방 스테이션', perm: 'station:manage', store: true },
    { to: '/store-menu', label: '매장 메뉴 운영', perm: 'menu:store', store: true },
    { to: '/devices', label: 'POS · 프린터 연결', perm: 'device:manage', store: true },
  ] },
  { group: '본부 · 지점', items: [
    { to: '/orgs', label: '조직(지점·가맹점)', perm: 'org:view' },
    { to: '/menus', label: '마스터 메뉴 · 레시피', perm: 'menu:view' },
    { to: '/analytics', label: '운영 품질 분석', perm: 'analytics:view' },
    { to: '/users', label: '사용자 · 권한', perm: 'user:manage' },
    { to: '/notices', label: '공지사항' },
  ] },
  { group: '시스템', items: [
    { to: '/audit', label: '감사 로그', perm: 'audit:view' },
    { to: '/system', label: '시스템 모니터링', perm: 'system:manage' },
  ] },
];

export default function Layout() {
  const { user, can, stores, storeId, setStoreId, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const isActive = (to) => {
    const [p, q] = to.split('?');
    return loc.pathname === p && (q ? loc.search.includes(q) : !loc.search.includes('view='));
  };

  return (
    <div className="layout">
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <NavLink to="/" className="logo" style={{ textDecoration: 'none' }}>
          MPS<small>Menu Portal Solution · Kitchen Control</small>
        </NavLink>
        {NAV.map((g) => {
          const items = g.items.filter((i) => (!i.perm || can(i.perm)) && (!i.store || stores.length));
          if (!items.length) return null;
          return (
            <div className="nav-group" key={g.group}>
              <div>{g.group}</div>
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} className={() => `nav-link ${isActive(i.to) ? 'active' : ''}`}>{i.label}</NavLink>
              ))}
            </div>
          );
        })}
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn sm menu-toggle" onClick={() => setOpen((v) => !v)} aria-label="메뉴">☰</button>
          {stores.length > 1 && (
            <select className="input" style={{ width: 'auto' }} value={storeId ?? ''} onChange={(e) => setStoreId(Number(e.target.value))} aria-label="매장 선택">
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {stores.length === 1 && <strong>{stores[0].name}</strong>}
          <div className="spacer" />
          <span className="badge info" style={{ whiteSpace: 'nowrap' }}>{ROLE_LABEL[user.role]}</span>
          <span className="small who">{user.orgName} · {user.name}</span>
          <NavLink to="/account" className="btn sm ghost">내 계정</NavLink>
          <button className="btn sm" onClick={logout}>로그아웃</button>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
