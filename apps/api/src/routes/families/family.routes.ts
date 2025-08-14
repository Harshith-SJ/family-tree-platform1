import { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { getDriver } from '../../lib/neo4j';
import { CreateFamilySchema } from '../../schemas/family';
import { AppError } from '../../errors/AppError';

export async function registerCoreFamilyRoutes(app: FastifyInstance){
  app.get('/families', { preHandler: requireAuth }, async (req) => {
    const userId = req.user!.sub; const session = getDriver().session();
    try {
      const res = await session.executeRead(tx=>tx.run(`MATCH (:Person { id:$userId })-[:MEMBER_OF]->(f:Family) RETURN f ORDER BY f.createdAt DESC`,{ userId }));
      return { families: res.records.map(r=>r.get('f').properties) };
    } finally { await session.close(); }
  });

  app.post('/families', { preHandler: requireAuth }, async (req, reply) => {
    const body = CreateFamilySchema.parse(req.body as unknown);
    const userId = req.user!.sub; const session = getDriver().session();
    try {
      const existing = await session.executeRead(tx=>tx.run(`MATCH (:Person { id:$userId })-[:MEMBER_OF]->(f:Family) RETURN f LIMIT 1`,{ userId }));
      const fam = existing.records[0]?.get('f');
      if(fam){ return reply.code(409).send({ message:'You already belong to a family.', family: fam.properties }); }
      const create = await session.executeWrite(tx=>tx.run(`MATCH (u:Person { id:$userId }) CREATE (f:Family { id: randomUUID(), name:$name, createdAt: datetime() }) MERGE (u)-[:MEMBER_OF]->(f) RETURN f`, { userId, name: body.name }));
      return reply.code(201).send({ family: create.records[0].get('f').properties });
    } finally { await session.close(); }
  });
}
