import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { requireAuth } from '../../middleware/auth';
import { getDriver } from '../../lib/neo4j';
import { UpsertPersonSchema, UpdatePositionSchema } from '../../schemas/family';
import { validatePassword } from '../../lib/password';
import { getIO } from '../../socket/io';

export async function registerPersonRoutes(app: FastifyInstance){
  // TODO: Person creation here duplicates logic in relation service for auditing & password hashing; consider consolidating via a shared helper.
  // Upsert person
  app.post('/families/:id/nodes', { preHandler: requireAuth }, async (req, reply) => {
  const familyId = (req.params as any).id as string;
  const userId = req.user!.sub;
    const body = UpsertPersonSchema.parse(req.body as unknown);
    const session = getDriver().session();
    try {
      if(body.id){
        // Optional email uniqueness enforcement on update
        if(body.email){
          const dup = await session.executeRead(tx=>tx.run(`MATCH (p:Person { email:$email }) WHERE p.id <> $id RETURN p LIMIT 1`, { email: body.email, id: body.id }));
          if(dup.records.length>0){ return reply.code(409).send({ message:'Email already exists for another person', code:'DUPLICATE' }); }
        }
        const hashed = body.tempPassword ? await bcrypt.hash(body.tempPassword,10): null;
  const res = await session.executeWrite(tx=>tx.run(`MATCH (p:Person { id:$id })-[:MEMBER_OF]->(:Family { id:$familyId }) SET p.name=$name, p.email=coalesce($email,p.email), p.posX=coalesce($posX,p.posX), p.posY=coalesce($posY,p.posY), p.gender=coalesce($gender,p.gender), p.birthDate=coalesce($birthDate,p.birthDate), p.deathDate=coalesce($deathDate,p.deathDate), p.notes=coalesce($notes,p.notes), p.password=coalesce(p.password,$password), p.updatedAt=datetime(), p.updatedBy=$updatedBy RETURN p`, { familyId, ...body, password: hashed, updatedBy: userId }));
        const node = res.records[0]?.get('p').properties; getIO()?.to(familyId).emit('node:upsert', node); return { node };
      } else {
        if(!body.email || !body.tempPassword) return reply.code(400).send({ message:'Email and temporary password required' });
        // Pre-flight duplicate email check to give friendly message (constraint still enforces globally)
        const dup = await session.executeRead(tx=>tx.run(`MATCH (p:Person { email:$email }) RETURN p LIMIT 1`, { email: body.email }));
        if(dup.records.length>0){ return reply.code(409).send({ message:'Email already exists for another person', code:'DUPLICATE' }); }
  const pwdErr = validatePassword(body.tempPassword);
  if (pwdErr) return reply.code(400).send({ message: pwdErr, code:'WEAK_PASSWORD' });
  const hashed = await bcrypt.hash(body.tempPassword,10);
  const res = await session.executeWrite(tx=>tx.run(`MATCH (f:Family { id:$familyId }) CREATE (p:Person { id: randomUUID(), name:$name, email:$email, posX:coalesce($posX,0), posY:coalesce($posY,0), gender:$gender, birthDate:$birthDate, deathDate:$deathDate, notes:$notes, password:$password, createdAt:datetime(), createdBy:$createdBy }) MERGE (p)-[m:MEMBER_OF]->(f) ON CREATE SET m.role='MEMBER' RETURN p`, { familyId, ...body, password: hashed, createdBy: userId }));
        const node = res.records[0]?.get('p').properties; getIO()?.to(familyId).emit('node:upsert', node); return reply.code(201).send({ node });
      }
    } finally { await session.close(); }
  });

  // Update position
  app.patch('/families/:id/nodes/:nodeId/position', { preHandler: requireAuth }, async (req, reply) => {
    const familyId = (req.params as any).id as string; const nodeId = (req.params as any).nodeId as string;
    const body = UpdatePositionSchema.parse(req.body as unknown); const session = getDriver().session();
    try {
      const res = await session.executeWrite(tx=>tx.run(`MATCH (p:Person { id:$nodeId })-[:MEMBER_OF]->(:Family { id:$familyId }) SET p.posX=$posX, p.posY=$posY, p.updatedAt=datetime() RETURN p`, { familyId, nodeId, ...body }));
      const node = res.records[0]?.get('p').properties; getIO()?.to(familyId).emit('node:move', { id:node.id, posX:node.posX, posY:node.posY }); return { node };
    } finally { await session.close(); }
  });

  // Delete person
  app.delete('/families/:id/nodes/:nodeId', { preHandler: requireAuth }, async (req, reply) => {
    const familyId = (req.params as any).id as string; const nodeId = (req.params as any).nodeId as string; const userId = req.user!.sub;
    if(nodeId === userId) return reply.code(403).send({ message:'You cannot delete your own node' });
    const session = getDriver().session();
    try {
  // Soft delete: mark deletedAt; keep relationships for historical context (could later scope queries to exclude)
  const res = await session.executeWrite(tx=>tx.run(`MATCH (p:Person { id:$nodeId })-[:MEMBER_OF]->(:Family { id:$familyId }) WHERE p.deletedAt IS NULL SET p.deletedAt = datetime(), p.updatedAt = datetime() RETURN p.id as id`, { familyId, nodeId }));
  if(!res.records[0]) return reply.code(404).send({ message:'Node not found', code:'NOT_FOUND' });
  getIO()?.to(familyId).emit('node:deleted', { id: nodeId }); return reply.code(204).send();
    } finally { await session.close(); }
  });
}
