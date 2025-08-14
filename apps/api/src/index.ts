import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { env } from './config/env';
import { registerAuthRoutes } from './routes';
import { registerCoreFamilyRoutes } from './routes/families/family.routes';
import { registerPersonRoutes } from './routes/families/person.routes';
import { registerEdgeRoutes } from './routes/families/edge.routes';
import { registerChatRoutes } from './routes/families/chat.routes';
import { registerTreeRoutes } from './routes/families/tree.routes';
import { closeDriver } from './lib/neo4j';
import { initIO } from './socket/io';
import { registerProfileRoutes } from './routes/profile';
import { registerRelationRoutes } from './routes/relations';
import { errorHandlingPlugin } from './plugins/errorHandler';
import { mutationLogPlugin } from './plugins/mutationLog';
import { ensureConstraints } from './lib/constraints';
import { renderPrometheus, requestCounter, requestLatency } from './metrics/registry';
import { rateLimitPlugin } from './plugins/rateLimit';

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
app.get('/metrics', async (_, reply) => {
  const text = renderPrometheus();
  reply.header('Content-Type','text/plain; version=0.0.4');
  return reply.send(text);
});

app.addHook('onClose', async () => {
  await closeDriver();
});

await app.register(registerAuthRoutes, { prefix: '/auth' });
await app.register(rateLimitPlugin);
await app.register(registerProfileRoutes, { prefix: '/profile' });
await app.register(registerCoreFamilyRoutes);
await app.register(registerPersonRoutes);
await app.register(registerEdgeRoutes);
await app.register(registerChatRoutes);
await app.register(registerTreeRoutes);
await app.register(registerRelationRoutes);
await app.register(errorHandlingPlugin);
await app.register(mutationLogPlugin);

// Global request metrics (after routes so routerPath available)
app.addHook('onRequest', async (req)=>{ (req as any)._reqStart = Date.now(); });
app.addHook('onResponse', async (req, reply)=>{
  const took = Date.now() - (req as any)._reqStart;
  const method = req.method;
  const route = (req as any).routerPath || req.url;
  const status = String(reply.statusCode);
  requestCounter.inc({ method, route, status });
  requestLatency.observe({}, took);
});

// Neo4j constraints (idempotency etc.)
await ensureConstraints();

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
