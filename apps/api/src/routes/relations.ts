import { FastifyInstance } from 'fastify';
import { getDriver } from '../lib/neo4j';
import { requireAuth } from '../middleware/auth';
import { AddRelationSchema, AddRelationInput } from '../schemas/relations';
import { AppError, toErrorPayload } from '../errors/AppError';
import { addRelationWrite } from '../services/relations';
import { getIdem, putIdem } from '../services/idempotency';
import { getIO } from '../socket/io';
import { relationCounter, relationLatency, mutationErrorCounter } from '../metrics/registry';
import { requireFamilyAdmin } from '../middleware/roles';

// Simple in-memory idempotency cache (user-sub scoped). For production, replace with shared store (Redis, etc.).
type CachedResponse = { status:number; payload:any; at:number };
const IDEM_CACHE = new Map<string, CachedResponse>();
const IDEM_TTL_MS = 10 * 60 * 1000; // 10 minutes
function buildKey(userSub:string, key:string){ return `${userSub}:${key}`; }
function getCached(userSub:string, key:string){
  const k = buildKey(userSub,key);
  const entry = IDEM_CACHE.get(k);
  if(!entry) return null;
  if(Date.now() - entry.at > IDEM_TTL_MS){ IDEM_CACHE.delete(k); return null; }
  return entry;
}
function storeCached(userSub:string, key:string, status:number, payload:any){
  const k = buildKey(userSub,key);
  IDEM_CACHE.set(k,{ status, payload, at: Date.now() });
}

// Initial subset; will expand (sibling, uncle_aunt, cousin, grandparents) in later phases
// Schema moved to schemas/relations.ts

export async function registerRelationRoutes(app: FastifyInstance) {
  app.post('/relations/add', { preHandler: requireAuth }, async (req, reply) => {
  // Some clients may double-stringify; tolerate a raw JSON string body.
  let incoming: any = req.body;
  if (process.env.DEBUG_RELATIONS === '1') {
    req.log.info({ evt:'relation_add_raw_body', typeof: typeof incoming, preview: typeof incoming === 'string' ? incoming.slice(0,200) : undefined });
  }
  if (typeof incoming === 'string') {
    try { incoming = JSON.parse(incoming); } catch { /* leave as string so schema throws */ }
  }
  const body: AddRelationInput = AddRelationSchema.parse(incoming as unknown);
    // Authorization: ensure user is admin of the reference person's family (if any family found)
    try {
      const sessionAuth = getDriver().session();
      const refFam = await sessionAuth.executeRead(tx=>tx.run(`MATCH (ref:Person { id:$rid })-[:MEMBER_OF]->(f:Family) RETURN f.id as fid LIMIT 1`, { rid: body.referenceId }));
      const fid = refFam.records[0]?.get('fid') as string|undefined;
      await sessionAuth.close();
      if (fid) {
        const isAdmin = await requireFamilyAdmin(fid, req.user!.sub);
        if (!isAdmin) return reply.code(403).send({ message:'Admin role required to add relations in this family', code:'FORBIDDEN' });
      }
    } catch(authErr){ return reply.code(500).send({ message:'Authorization check failed', code:'AUTH_CHECK_FAILED' }); }
    const idemKey = (req.headers['idempotency-key'] || req.headers['Idempotency-Key']) as string | undefined;
    if (idemKey && req.user?.sub) {
      // 1. Persistent store lookup
      const persisted = await getIdem(req.user.sub, idemKey);
      if (persisted) return reply.code(persisted.status).send(persisted.payload);
      // 2. In-memory fallback (short window) during migration
      const cached = getCached(req.user.sub, idemKey);
      if (cached) return reply.code(cached.status).send(cached.payload);
    }
    const driver = getDriver();
    const session = driver.session();
  const start = Date.now();
    try {
  const userId = req.user?.sub as string;
      const txResult = await session.executeWrite((tx:any) => addRelationWrite(tx, body, userId));
      // Broadcast created nodes & edges to specific family room when available for efficient real-time updates.
      try {
        const io = getIO();
        if (io) {
          const room = txResult.familyId || undefined;
          const target = room ? io.to(room) : io; // fallback to global if family unknown
          txResult.nodes.forEach((n:any)=> target.emit('node:upsert', n));
          txResult.edges.forEach((e:any)=> target.emit('edge:created', { id: e.id || `${e.sourceId}-${e.targetId}-${e.type}`, sourceId: e.sourceId, targetId: e.targetId, type: e.type, label: e.type==='SPOUSE_OF'?'SPOUSE':e.type==='PARENT_OF'?'PARENT':e.type }));
        }
      } catch(err){ req.log.error({ evt:'relation_socket_emit_failed', err }); }
  req.log.info({ evt:'relation_add_success', relationType: body.relationType, referenceId: body.referenceId, createdCount: txResult.nodes.length });
  relationCounter.inc({ relationType: body.relationType });
  relationLatency.observe({}, Date.now()-start);
      if (idemKey && req.user?.sub) {
        storeCached(req.user.sub, idemKey, 201, txResult); // short-term
        await putIdem(req.user.sub, idemKey, 201, txResult, 600);
      }
      return reply.code(201).send(txResult);
    } catch (e:any) {
      req.log.error({ evt:'relation_add_failure', relationType: body.relationType, referenceId: body.referenceId, code: e.code, message: e.message });
      if(process.env.DEBUG_RELATIONS==='1' && body.relationType==='cousin') {
        console.error('DEBUG cousin route failure', { body, stack: e.stack });
      }
      if(process.env.DEBUG_RELATIONS==='1') {
        console.log('DEBUG route failure generic', { relationType: body.relationType, message: e.message, code: e.code, stack: e.stack });
      }
  mutationErrorCounter.inc({ code: e.code || 'UNKNOWN' });
      const payload = toErrorPayload(e);
      if (e instanceof AppError) return reply.code(e.status).send(payload);
      req.log.error(e);
      return reply.code(500).send(payload);
    } finally { await session.close(); }
  });
}
