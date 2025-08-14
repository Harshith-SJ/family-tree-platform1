import { FastifyReply, FastifyRequest } from 'fastify';
import { getDriver } from '../lib/neo4j';

export async function requireFamilyAdmin(familyId: string, userId: string){
  const session = getDriver().session();
  try {
    const res = await session.executeRead(tx=>tx.run(`MATCH (u:Person { id:$uid })-[m:MEMBER_OF]->(f:Family { id:$fid }) RETURN coalesce(m.role,'ADMIN') as role`, { uid:userId, fid:familyId }));
    const role = res.records[0]?.get('role');
    return role === 'ADMIN';
  } finally { await session.close(); }
}

export function ensureAdminInFamilyParam(paramName: string){
  return async function(req: FastifyRequest, reply: FastifyReply){
    const familyId = (req.params as any)[paramName];
    const userId = req.user!.sub;
    const ok = await requireFamilyAdmin(familyId, userId);
    if(!ok){ return reply.code(403).send({ message:'Admin role required for this operation', code:'FORBIDDEN' }); }
  };
}
