import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { getToken } from './api.js';

// 매장 룸에 연결해 실시간 이벤트 수신. 재연결 시 onReconnect 로 전체 재조회.
export function useStoreSocket(storeId, handlers, onStatus) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  useEffect(() => {
    if (!storeId) return undefined;
    const socket = io({ auth: { token: getToken() }, transports: ['websocket', 'polling'] });
    const join = () => socket.emit('store:join', { storeId }, (ack) => {
      statusRef.current?.(ack?.ok ? 'online' : 'denied');
      ref.current.onReconnect?.();
    });
    socket.on('connect', join);
    socket.on('disconnect', () => statusRef.current?.('offline'));
    socket.on('connect_error', () => statusRef.current?.('offline'));
    for (const ev of ['order:created', 'order:updated', 'menu:changed', 'stations:changed']) {
      socket.on(ev, (payload) => ref.current[ev]?.(payload));
    }
    return () => socket.disconnect();
  }, [storeId]);
}
