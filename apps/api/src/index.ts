import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { env } from './config/env';
import { registerAuthRoutes } from './routes';
import { registerFamilyRoutes } from './routes/families';
import { closeDriver } from './lib/neo4j';
import { initIO } from './socket/io';
import { registerProfileRoutes } from './routes/profile';

const app = Fastify({ logger: true });

await app.register(cors, {
  credentials: true,
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    try {
      const u = new URL(origin);
      const host = u.hostname;
      if (host === 'localhost' || host === '127.0.0.1') return cb(null, true);
    } catch {}
    if (origin === env.CORS_ORIGIN) return cb(null, true);
    cb(null, false);
  },
});
await app.register(cookie, { hook: 'onRequest' });
await app.register(helmet);

app.get('/health', async () => ({ status: 'ok' }));

app.addHook('onClose', async () => {
  await closeDriver();
});

await app.register(registerAuthRoutes, { prefix: '/auth' });
await app.register(registerProfileRoutes, { prefix: '/profile' });
await app.register(registerFamilyRoutes);

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then((address) => {
    // @ts-ignore - get the underlying Node server
    const server = app.server;
    initIO(server);
    app.log.info(`API listening on :${env.PORT}`);
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
