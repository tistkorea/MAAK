import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import { Toaster } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Kds from './pages/Kds.jsx';
import Orders from './pages/Orders.jsx';
import PosTest from './pages/PosTest.jsx';
import Stations from './pages/Stations.jsx';
import StoreMenu from './pages/StoreMenu.jsx';
import Devices from './pages/Devices.jsx';
import Orgs from './pages/Orgs.jsx';
import MasterMenu from './pages/MasterMenu.jsx';
import Analytics from './pages/Analytics.jsx';
import Users from './pages/Users.jsx';
import Notices from './pages/Notices.jsx';
import Audit from './pages/Audit.jsx';
import SystemPage from './pages/System.jsx';
import Account from './pages/Account.jsx';

function Guard({ perm, store, children }) {
  const { can, storeId } = useAuth();
  if (perm && !can(perm)) return <div className="error">이 화면에 대한 권한이 없습니다.</div>;
  if (store && !storeId) return <div className="empty">접근 가능한 매장이 없습니다.</div>;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">불러오는 중…</div>;
  if (!user) return (<><Login /><Toaster /></>);

  return (
    <>
      <Routes>
        <Route path="/kds" element={<Guard perm="kds:operate" store><Kds /></Guard>} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="orders" element={<Guard perm="kds:operate" store><Orders /></Guard>} />
          <Route path="pos-test" element={<Guard perm="order:create" store><PosTest /></Guard>} />
          <Route path="stations" element={<Guard perm="station:manage" store><Stations /></Guard>} />
          <Route path="store-menu" element={<Guard perm="menu:store" store><StoreMenu /></Guard>} />
          <Route path="devices" element={<Guard perm="device:manage" store><Devices /></Guard>} />
          <Route path="orgs" element={<Guard perm="org:view"><Orgs /></Guard>} />
          <Route path="menus" element={<Guard perm="menu:view"><MasterMenu /></Guard>} />
          <Route path="analytics" element={<Guard perm="analytics:view"><Analytics /></Guard>} />
          <Route path="users" element={<Guard perm="user:manage"><Users /></Guard>} />
          <Route path="notices" element={<Notices />} />
          <Route path="audit" element={<Guard perm="audit:view"><Audit /></Guard>} />
          <Route path="system" element={<Guard perm="system:manage"><SystemPage /></Guard>} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}
