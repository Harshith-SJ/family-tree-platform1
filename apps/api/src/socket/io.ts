import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { env } from '../config/env';

let io: Server | null = null;

export function initIO(server: HttpServer) {
  if (io) return io;
  io = new Server(server, {
    cors: { origin: env.CORS_ORIGIN, credentials: true },
  });

  io.on('connection', (socket) => {
    socket.on('join-family', (familyId: string) => {
      socket.join(familyId);
      socket.emit('joined-family', familyId);
    });

    socket.on('disconnect', () => {
      // no-op for now
    });
  });

  return io;
}

export function getIO() {
  return io;
}
