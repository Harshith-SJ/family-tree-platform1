import { FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '../lib/jwt';

export type AuthPayload = { sub: string; email: string };

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthPayload;
  }
}

export function requireAuth(req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) {
  const token = (req.cookies as any)?.token as string | undefined;
  if (!token) {
    reply.code(401).send({ message: 'Unauthorized' });
    return;
  }
  try {
    const payload = verifyToken(token);
    req.user = payload;
    done();
  } catch {
    reply.code(401).send({ message: 'Unauthorized' });
  }
}
