import { FastifyInstance } from 'fastify';

// Lightweight hook to emit structured logs for mutating requests.
// Extend later with metrics counters & latency histograms.
export async function mutationLogPlugin(app: FastifyInstance){
  app.addHook('onRequest', async (req) => { (req as any).startTime = Date.now(); });
  app.addHook('onError', async (req, reply, error) => {
    const method = req.method;
    if(method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return;
    const route = (req as any).routerPath || req.url;
    const userId = (req as any).user?.sub;
    const tookMs = Date.now() - (req as any).startTime;
    const code = (error as any)?.code || (error as any)?.code === 0 ? (error as any).code : undefined;
    const relationType = (req.body as any)?.relationType;
    req.log.error({ evt:'mutation_error', method, route, userId, tookMs, message: error.message, code, relationType, status: reply.statusCode });
  });
  app.addHook('onResponse', async (req, reply) => {
    const method = req.method;
    if(method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return; // only mutations
    const route = (req as any).routerPath || req.url;
    const status = reply.statusCode;
    const userId = (req as any).user?.sub;
    const tookMs = Date.now() - (req as any).startTime;
    const relationType = (req.body as any)?.relationType;
    req.log.info({ evt:'mutation', method, route, status, userId, tookMs, relationType });
  });
}
