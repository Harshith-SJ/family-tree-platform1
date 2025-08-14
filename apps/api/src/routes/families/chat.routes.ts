import { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { getDriver } from '../../lib/neo4j';
import { CreateMessageSchema } from '../../schemas/family';
import { getIO } from '../../socket/io';

export async function registerChatRoutes(app: FastifyInstance){
  app.get('/families/:id/messages', { preHandler: requireAuth }, async (req) => {
    const familyId = (req.params as any).id as string; const limit = Number((req.query as any)?.limit ?? 50);
    const session = getDriver().session();
    try {
      const res = await session.executeRead(tx=>tx.run(`MATCH (f:Family { id:$fid })<-[:IN]-(m:Message) RETURN m ORDER BY m.createdAt DESC LIMIT $limit`, { fid:familyId, limit }));
      return { messages: res.records.map(r=>r.get('m').properties).map((m:any)=>({ id:m.id, text:m.text, userId:m.userId, userName:m.userName, createdAt:m.createdAt })).reverse() };
    } finally { await session.close(); }
  });

  app.post('/families/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    const familyId = (req.params as any).id as string; const userId = req.user!.sub; const body = CreateMessageSchema.parse(req.body as unknown); const session = getDriver().session();
    try {
      const res = await session.executeWrite(tx=>tx.run(`MATCH (f:Family { id:$fid }) MATCH (u:Person { id:$uid }) CREATE (m:Message { id:randomUUID(), text:$text, userId:$uid, userName:coalesce(u.name,'User'), createdAt:datetime() })-[:IN]->(f) RETURN m`, { fid:familyId, uid:userId, text: body.text }));
      const m = res.records[0].get('m').properties; const message = { id:m.id, text:m.text, userId:m.userId, userName:m.userName, createdAt:m.createdAt };
      getIO()?.to(familyId).emit('chat:message', message); return reply.code(201).send({ message });
    } finally { await session.close(); }
  });
}
