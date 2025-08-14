import { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { getDriver } from '../../lib/neo4j';

export async function registerTreeRoutes(app: FastifyInstance){
  app.get('/families/:id/tree', { preHandler: requireAuth }, async (req) => {
    const familyId = (req.params as any).id as string; const session = getDriver().session();
    try {
  const nodesRes = await session.executeRead(tx=>tx.run(`MATCH (p:Person)-[:MEMBER_OF]->(:Family { id:$fid }) WHERE p.deletedAt IS NULL RETURN p`, { fid:familyId }));
      const nodes = nodesRes.records.map(r=>{ const p = r.get('p'); const props = p.properties; return { id: props.id, type:'default', data:{ name: props.name, email: props.email??null, gender: props.gender??null, birthDate: props.birthDate??null, deathDate: props.deathDate??null, notes: props.notes??null }, position:{ x:Number(props.posX??0), y:Number(props.posY??0) } }; });
  const edgesRes = await session.executeRead(tx=>tx.run(`MATCH (a:Person)-[r:SPOUSE_OF|PARENT_OF]->(b:Person) WHERE (a)-[:MEMBER_OF]->(:Family { id:$fid }) AND (b)-[:MEMBER_OF]->(:Family { id:$fid }) AND a.deletedAt IS NULL AND b.deletedAt IS NULL AND coalesce(r.deletedAt,'')='' RETURN a.id as source, b.id as target, type(r) as rawType, coalesce(r.id,'') as id, r.label as storedLabel, a.gender as aGender`, { fid: familyId }));
  const edges = edgesRes.records.map(r=>{ const rawType = r.get('rawType'); let label = r.get('storedLabel'); if(!label && rawType==='PARENT_OF'){ const g = r.get('aGender'); label = g==='FEMALE'?'MOTHER': g==='MALE'?'FATHER':'PARENT'; } if(label==='PARENT'){ const g = r.get('aGender'); label = g==='FEMALE'?'MOTHER': g==='MALE'?'FATHER':'PARENT'; } if(!label && rawType==='SPOUSE_OF') label='SPOUSE'; const id = r.get('id') || `${r.get('source')}-${r.get('target')}-${label}`; return { id, source: r.get('source'), target: r.get('target'), label, data:{ type: label } }; });
      return { nodes, edges };
    } finally { await session.close(); }
  });
}
