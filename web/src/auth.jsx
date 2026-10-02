import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, post, setToken, getToken } from './api.js';

const AuthCtx = createContext(null);
const STORE_KEY = 'mps.store';

export function AuthProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [storeId, setStoreIdState] = useState(() => Number(localStorage.getItem(STORE_KEY)) || null);

  const refresh = useCallback(async () => {
    if (!getToken()) { setMe(null); setLoading(false); return; }
    try {
      const data = await api('/auth/me');
      setMe(data);
      setStoreIdState((cur) => (data.stores.some((s) => s.id === cur) ? cur : data.stores[0]?.id ?? null));
    } catch {
      setToken(null);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const onUnauth = () => { setToken(null); setMe(null); };
    window.addEventListener('mps:unauthorized', onUnauth);
    return () => window.removeEventListener('mps:unauthorized', onUnauth);
  }, []);

  const login = async (loginId, password) => {
    const { token } = await post('/auth/login', { loginId, password });
    setToken(token);
    setLoading(true);
    await refresh();
  };
  const logout = () => { setToken(null); setMe(null); };
  const setStoreId = (id) => { localStorage.setItem(STORE_KEY, String(id)); setStoreIdState(id); };

  const value = useMemo(() => ({
    me, loading, login, logout, refresh,
    user: me?.user,
    stores: me?.stores || [],
    storeId, setStoreId,
    store: me?.stores?.find((s) => s.id === storeId) || null,
    can: (perm) => Boolean(me?.permissions?.includes(perm)),
  }), [me, loading, storeId]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
