// 실시간 주문 전송: 매장(store:{id}) 룸 단위로 KDS·패스 화면에 브로드캐스트
import { Server } from 'socket.io';
import { config } from '../config.js';
import { userFromToken } from '../auth/auth.js';
import { hasPermission } from '../auth/rbac.js';
import { getOrg, inScope } from '../services/scope.js';

let io = null;

export function initRealtime(httpServer) {
  io = new Server(httpServer, { cors: { origin: config.corsOrigin } });

  io.use(async (socket, next) => {
    const user = await userFromToken(socket.handshake.auth?.token).catch(() => null);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    socket.on('store:join', async ({ storeId } = {}, ack) => {
      const user = socket.data.user;
      const org = await getOrg(Number(storeId)).catch(() => null);
      const ok = org?.type === 'store' && inScope(user, org) && hasPermission(user.role, 'kds:operate');
      if (ok) {
        for (const room of socket.rooms) if (room.startsWith('store:')) socket.leave(room);
        socket.join(`store:${org.id}`);
      }
      if (typeof ack === 'function') ack({ ok });
    });
  });
  return io;
}

export function emitStore(storeId, event, payload) {
  io?.to(`store:${storeId}`).emit(event, payload);
}

export function realtimeStats() {
  if (!io) return { connections: 0, rooms: {} };
  const rooms = {};
  for (const [name, set] of io.sockets.adapter.rooms) if (name.startsWith('store:')) rooms[name] = set.size;
  return { connections: io.engine.clientsCount, rooms };
}
