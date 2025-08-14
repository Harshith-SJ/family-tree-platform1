import { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { getDriver } from '../../lib/neo4j';
import { CreateEdgeSchema } from '../../schemas/family';
import { getIO } from '../../socket/io';

export async function registerEdgeRoutes(app: FastifyInstance){
  // TODO: Eventually deprecate this manual edge creation in favor of unified /relations/add service flow (see services/relations.ts)
  app.post('/families/:id/edges', { preHandler: requireAuth }, async (req, reply) => {
    const familyId = (req.params as any).id as string; const body = CreateEdgeSchema.parse(req.body as unknown); const userId = req.user!.sub;
    // Deprecation: biological relations now handled via /relations/add for auditing + idempotency.
    if(['MOTHER','FATHER','SON','DAUGHTER','SPOUSE'].includes(body.type)){
      return reply.code(410).send({ message:'Deprecated route. Use POST /relations/add with appropriate relationType.', code:'DEPRECATED' });
    }
    const session = getDriver().session();
    try {
      if(body.sourceId === body.targetId) return reply.code(400).send({ message:'Cannot relate person to self' });
      const check = await session.executeRead(tx=>tx.run(`MATCH (a:Person { id:$a })-[:MEMBER_OF]->(f:Family { id:$fid }) MATCH (b:Person { id:$b })-[:MEMBER_OF]->(f) RETURN a,b`, { a:body.sourceId, b:body.targetId, fid:familyId }));
      if(check.records.length===0) return reply.code(400).send({ message:'Both people must be in the same family' });
      // Enforce biological parent limit when creating parent/child edges manually
      if(body.type==='MOTHER' || body.type==='FATHER' || body.type==='SON' || body.type==='DAUGHTER'){
        // For SON/DAUGHTER edge we create parent->child (source->target). For MOTHER/FATHER edge we also interpret source as parent.
        // Determine the prospective child id consistently as targetId.
        const childId = body.targetId;
        const parentCountRes = await session.executeRead(tx=>tx.run(`MATCH (:Person)-[:PARENT_OF]->(c:Person { id:$cid }) RETURN count(*) as cnt`, { cid: childId }));
        const cnt = parentCountRes.records[0].get('cnt').toNumber();
        if(cnt >= 2){ return reply.code(400).send({ message:'Child already has two parents', code:'LIMIT' }); }
      }
      if(body.type==='SPOUSE'){
  const res = await session.executeWrite(tx=>tx.run(`MATCH (a:Person { id:$a })-[:MEMBER_OF]->(:Family { id:$fid }), (b:Person { id:$b })-[:MEMBER_OF]->(:Family { id:$fid }) MERGE (a)-[r:SPOUSE_OF]->(b) ON CREATE SET r.id=randomUUID(), r.label=coalesce($label,'SPOUSE'), r.createdAt=datetime(), r.createdBy=$userId SET r.updatedAt=datetime(), r.updatedBy=$userId MERGE (b)-[r2:SPOUSE_OF]->(a) ON CREATE SET r2.id=randomUUID(), r2.label=coalesce($label,'SPOUSE'), r2.createdAt=datetime(), r2.createdBy=$userId SET r2.updatedAt=datetime(), r2.updatedBy=$userId RETURN r`, { a:body.sourceId, b:body.targetId, fid:familyId, label: body.label??null, userId }));
        const r = res.records[0]?.get('r'); if(!r) return reply.code(400).send({ message:'Failed to create spouse relationship' });
        const edge = { id:r.properties.id, sourceId: body.sourceId, targetId: body.targetId, type: body.type, label: r.properties.label };
        getIO()?.to(familyId).emit('edge:created', edge); return reply.code(201).send({ edge });
      } else {
        // Map edge type to stored label while relationship type in graph remains PARENT_OF
  const res = await session.executeWrite(tx=>tx.run(`MATCH (a:Person { id:$a })-[:MEMBER_OF]->(:Family { id:$fid }), (b:Person { id:$b })-[:MEMBER_OF]->(:Family { id:$fid }) MERGE (a)-[r:PARENT_OF]->(b) ON CREATE SET r.id=randomUUID(), r.label=coalesce($label,$type), r.createdAt=datetime(), r.createdBy=$userId SET r.updatedAt=datetime(), r.updatedBy=$userId RETURN r`, { a:body.sourceId, b:body.targetId, fid:familyId, label: body.label??null, type: body.type, userId }));
        const r = res.records[0]?.get('r'); if(!r) return reply.code(400).send({ message:'Failed to create parent relationship' });
        const edge = { id:r.properties.id, sourceId: body.sourceId, targetId: body.targetId, type: body.type, label: r.properties.label };
        getIO()?.to(familyId).emit('edge:created', edge); return reply.code(201).send({ edge });
      }
    } finally { await session.close(); }
  });

  app.delete('/families/:id/edges/:edgeId', { preHandler: requireAuth }, async (req, reply) => {
    const familyId = (req.params as any).id as string; const edgeId = (req.params as any).edgeId as string; const session = getDriver().session();
    try {
  const res = await session.executeWrite(tx=>tx.run(`MATCH (a:Person)-[r:SPOUSE_OF|PARENT_OF]->(b:Person) WHERE r.id=$edgeId AND (a)-[:MEMBER_OF]->(:Family { id:$fid }) AND (b)-[:MEMBER_OF]->(:Family { id:$fid }) AND coalesce(r.deletedAt,'') = '' SET r.deletedAt = datetime(), r.updatedAt = datetime() RETURN r.id as id`, { edgeId, fid:familyId }));
  if(res.records.length===0) return reply.code(404).send({ message:'Edge not found', code:'NOT_FOUND' });
  getIO()?.to(familyId).emit('edge:deleted', { id: edgeId }); return reply.code(204).send();
    } finally { await session.close(); }
  });
}
