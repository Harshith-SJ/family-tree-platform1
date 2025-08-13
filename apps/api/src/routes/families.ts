import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDriver } from '../lib/neo4j';
import bcrypt from 'bcryptjs';
import { getIO } from '../socket/io';
import { requireAuth } from '../middleware/auth';

const createFamilySchema = z.object({ name: z.string().min(2) });

const upsertNodeSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  email: z.string().email().optional(),
  posX: z.number().optional(),
  posY: z.number().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  birthDate: z.string().optional(),
  deathDate: z.string().optional(),
  notes: z.string().optional(),
  // If provided along with email, this will be saved as the initial login password
  tempPassword: z.string().min(8).optional(),
});

const updatePositionSchema = z.object({ posX: z.number(), posY: z.number() });

const createEdgeSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  type: z.enum(['SPOUSE', 'PARENT', 'SON', 'DAUGHTER']),
  label: z.string().optional(),
});

const createMessageSchema = z.object({
  text: z.string().min(1).max(2000),
});

export async function registerFamilyRoutes(app: FastifyInstance) {
  // List families for current user
  app.get('/families', { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.user!.sub;
    const driver = getDriver();
    const session = driver.session();
    try {
      const result = await session.executeRead((tx) =>
        tx.run(
          `MATCH (:Person { id: $userId })-[:MEMBER_OF]->(f:Family)
           RETURN f ORDER BY f.createdAt DESC`
          , { userId }
        )
      );
      const families = result.records.map((r) => r.get('f').properties);
      return { families };
    } finally {
      await session.close();
    }
  });

  // Create a family and link current user
  app.post('/families', { preHandler: requireAuth }, async (req, reply) => {
    const body = createFamilySchema.parse(req.body as unknown);
    const userId = req.user!.sub;
    const driver = getDriver();
    const session = driver.session();
    try {
      // Disallow creating more than one family per user
      const existing = await session.executeRead((tx) =>
        tx.run(
          `MATCH (:Person { id: $userId })-[:MEMBER_OF]->(f:Family)
           RETURN f LIMIT 1`,
          { userId }
        )
      );
      const existingFam = existing.records[0]?.get('f');
      if (existingFam) {
        return reply.code(409).send({ message: 'You already belong to a family. Creating multiple families is not allowed.', family: existingFam.properties });
      }

      const result = await session.executeWrite((tx) =>
        tx.run(
          `MATCH (u:Person { id: $userId })
           CREATE (f:Family { id: randomUUID(), name: $name, createdAt: datetime() })
           MERGE (u)-[:MEMBER_OF]->(f)
           RETURN f`,
          { userId, name: body.name }
        )
      );
      const f = result.records[0]?.get('f');
      return reply.code(201).send({ family: f.properties });
    } finally {
      await session.close();
    }
  });

  // Get tree (nodes and edges) for a family
  app.get('/families/:id/tree', { preHandler: requireAuth }, async (req, reply) => {
    const familyId = (req.params as any).id as string;
    const driver = getDriver();
    const session = driver.session();
    try {
      const nodesRes = await session.executeRead((tx) =>
        tx.run(
          `MATCH (p:Person)-[:MEMBER_OF]->(:Family { id: $familyId })
           RETURN p`,
          { familyId }
        )
      );
      const nodes = nodesRes.records.map((r) => {
        const p = r.get('p');
        const props = p.properties;
        return {
          id: props.id,
          type: 'default',
          data: {
            name: props.name,
            email: props.email ?? null,
            gender: props.gender ?? null,
            birthDate: props.birthDate ?? null,
            deathDate: props.deathDate ?? null,
            notes: props.notes ?? null,
          },
          position: { x: Number(props.posX ?? 0), y: Number(props.posY ?? 0) },
        };
      });

      const edgesRes = await session.executeRead((tx) =>
        tx.run(
          `MATCH (a:Person)-[r:SPOUSE_OF|PARENT_OF]->(b:Person)
           WHERE (a)-[:MEMBER_OF]->(:Family { id: $familyId }) AND (b)-[:MEMBER_OF]->(:Family { id: $familyId })
           RETURN a.id as source, b.id as target, type(r) as type, coalesce(r.id, '') as id, r.label as label`,
          { familyId }
        )
      );
      const edges = edgesRes.records.map((r) => {
        const rawType = r.get('type') as string; // 'SPOUSE_OF' | 'PARENT_OF'
        const label = r.get('label') as string | null; // may be 'PARENT'|'SON'|'DAUGHTER'|'SPOUSE'
        const normalized = label ?? (rawType === 'PARENT_OF' ? 'PARENT' : 'SPOUSE');
        return {
          id: r.get('id') || `${r.get('source')}-${r.get('target')}-${normalized}`,
          source: r.get('source'),
          target: r.get('target'),
          label: normalized,
          data: { type: normalized },
        };
      });

      return { nodes, edges };
    } finally {
      await session.close();
    }
  });

  // Upsert node (create or update person) in family
  app.post('/families/:id/nodes', { preHandler: requireAuth }, async (req, reply) => {
    const familyId = (req.params as any).id as string;
    const body = upsertNodeSchema.parse(req.body as unknown);
    const driver = getDriver();
    const session = driver.session();
    try {
      if (body.id) {
        // Hash temp password if provided
        const hashed = body.tempPassword ? await bcrypt.hash(body.tempPassword, 10) : null;
        const res = await session.executeWrite((tx) =>
          tx.run(
            `MATCH (p:Person { id: $id })-[:MEMBER_OF]->(:Family { id: $familyId })
             SET p.name = $name,
                 p.email = coalesce($email, p.email),
                 p.posX = coalesce($posX, p.posX),
                 p.posY = coalesce($posY, p.posY),
            p.gender = coalesce($gender, p.gender),
            p.birthDate = coalesce($birthDate, p.birthDate),
            p.deathDate = coalesce($deathDate, p.deathDate),
            p.notes = coalesce($notes, p.notes),
            p.password = coalesce(p.password, $password),
                 p.updatedAt = datetime()
             RETURN p`,
            {
              familyId,
              id: body.id,
              name: body.name,
              email: body.email ?? null,
              posX: body.posX ?? null,
              posY: body.posY ?? null,
          gender: body.gender ?? null,
          birthDate: body.birthDate ?? null,
          deathDate: body.deathDate ?? null,
          notes: body.notes ?? null,
              password: hashed,
            }
          )
        );
  const p = res.records[0]?.get('p');
  const node = p?.properties;
  getIO()?.to(familyId).emit('node:upsert', node);
  return reply.send({ node });
      } else {
        // On create, email and a temporary password are mandatory to issue initial credentials
        if (!body.email || !body.tempPassword) {
          return reply.code(400).send({ message: 'Email and temporary password are required when adding a new person' });
        }
        const hashed = body.tempPassword ? await bcrypt.hash(body.tempPassword, 10) : null;
        const res = await session.executeWrite((tx) =>
          tx.run(
            `MATCH (f:Family { id: $familyId })
             CREATE (p:Person {
               id: randomUUID(), name: $name, email: $email,
               posX: coalesce($posX, 0), posY: coalesce($posY, 0),
               gender: $gender, birthDate: $birthDate, deathDate: $deathDate, notes: $notes,
               password: $password,
               createdAt: datetime() })
             MERGE (p)-[:MEMBER_OF]->(f)
             RETURN p`,
            {
              familyId,
              name: body.name,
              email: body.email ?? null,
              posX: body.posX ?? null,
              posY: body.posY ?? null,
              gender: body.gender ?? null,
              birthDate: body.birthDate ?? null,
              deathDate: body.deathDate ?? null,
              notes: body.notes ?? null,
              password: hashed,
            }
          )
        );
  const p = res.records[0]?.get('p');
  const node = p?.properties;
  getIO()?.to(familyId).emit('node:upsert', node);
  return reply.code(201).send({ node });
      }
    } finally {
      await session.close();
    }
  });

  // Update node position only
  app.patch('/families/:id/nodes/:nodeId/position', { preHandler: requireAuth }, async (req, reply) => {
    const familyId = (req.params as any).id as string;
    const nodeId = (req.params as any).nodeId as string;
    const body = updatePositionSchema.parse(req.body as unknown);
    const driver = getDriver();
    const session = driver.session();
    try {
      const res = await session.executeWrite((tx) =>
        tx.run(
          `MATCH (p:Person { id: $nodeId })-[:MEMBER_OF]->(:Family { id: $familyId })
           SET p.posX = $posX, p.posY = $posY, p.updatedAt = datetime()
           RETURN p`,
          { familyId, nodeId, ...body }
        )
      );
  const p = res.records[0]?.get('p');
  const node = p?.properties;
  getIO()?.to(familyId).emit('node:move', { id: node.id, posX: node.posX, posY: node.posY });
  return reply.send({ node });
    } finally {
      await session.close();
    }
  });

  // Delete a node and its relationships within a family
  app.delete('/families/:id/nodes/:nodeId', { preHandler: requireAuth }, async (req, reply) => {
    const familyId = (req.params as any).id as string;
    const nodeId = (req.params as any).nodeId as string;
    const driver = getDriver();
    const session = driver.session();
    try {
      const res = await session.executeWrite((tx) =>
        tx.run(
          `MATCH (p:Person { id: $nodeId })-[:MEMBER_OF]->(:Family { id: $familyId })
           WITH p
           DETACH DELETE p
           RETURN $nodeId as id`,
          { familyId, nodeId }
        )
      );
      const deletedId = res.records[0]?.get('id');
      getIO()?.to(familyId).emit('node:deleted', { id: deletedId });
      return reply.code(204).send();
    } finally {
      await session.close();
    }
  });

  // Create edge/relationship
  app.post('/families/:id/edges', { preHandler: requireAuth }, async (req, reply) => {
    const familyId = (req.params as any).id as string;
    const body = createEdgeSchema.parse(req.body as unknown);
    const driver = getDriver();
    const session = driver.session();
    try {
      if (body.sourceId === body.targetId) {
        return reply.code(400).send({ message: 'Cannot create a relationship to the same person' });
      }
      // Ensure both nodes exist and are in the family
      const check = await session.executeRead((tx) =>
        tx.run(
          `MATCH (a:Person { id: $sourceId })-[:MEMBER_OF]->(f:Family { id: $familyId })
           MATCH (b:Person { id: $targetId })-[:MEMBER_OF]->(f)
           RETURN a.id as a, b.id as b`,
          { familyId, sourceId: body.sourceId, targetId: body.targetId }
        )
      );
      if (check.records.length === 0) {
        return reply.code(400).send({ message: 'Both people must be in the same family' });
      }
  if (body.type === 'SPOUSE') {
    const res = await session.executeWrite((tx) =>
          tx.run(
            `MATCH (a:Person { id: $sourceId })-[:MEMBER_OF]->(:Family { id: $familyId }),
                   (b:Person { id: $targetId })-[:MEMBER_OF]->(:Family { id: $familyId })
             MERGE (a)-[r:SPOUSE_OF]->(b)
             SET r.id = coalesce(r.id, randomUUID()), r.label = coalesce(r.label, coalesce($label, 'SPOUSE'))
             MERGE (b)-[r2:SPOUSE_OF]->(a)
             SET r2.id = coalesce(r2.id, randomUUID()), r2.label = coalesce(r2.label, coalesce($label, 'SPOUSE'))
             RETURN r`,
      { familyId, ...body, label: body.label ?? null, type: body.type }
          )
        );
        const r = res.records[0]?.get('r');
        if (!r) return reply.code(400).send({ message: 'Could not create spouse relationship' });
        const edge = { id: r.properties.id, sourceId: body.sourceId, targetId: body.targetId, type: body.type, label: r.properties.label };
  getIO()?.to(familyId).emit('edge:created', edge);
  return reply.code(201).send({ edge });
      } else {
        // PARENT, SON, DAUGHTER will be represented as PARENT_OF edge; label carries the specific type
    const res = await session.executeWrite((tx) =>
          tx.run(
            `MATCH (a:Person { id: $sourceId })-[:MEMBER_OF]->(:Family { id: $familyId }),
                   (b:Person { id: $targetId })-[:MEMBER_OF]->(:Family { id: $familyId })
             MERGE (a)-[r:PARENT_OF]->(b)
             SET r.id = coalesce(r.id, randomUUID()), r.label = coalesce(r.label, coalesce($label, $type))
             RETURN r`,
      { familyId, ...body, label: body.label ?? null, type: body.type }
          )
        );
        const r = res.records[0]?.get('r');
        if (!r) return reply.code(400).send({ message: 'Could not create parent relationship' });
        const edge = { id: r.properties.id, sourceId: body.sourceId, targetId: body.targetId, type: body.type, label: r.properties.label };
  getIO()?.to(familyId).emit('edge:created', edge);
  return reply.code(201).send({ edge });
       }
     } catch (err: any) {
      req.log.error({ err, familyId, body }, 'Failed to create edge');
      return reply.code(500).send({ message: 'Failed to create relationship', error: String(err?.message || err) });
     } finally {
      await session.close();
    }
  });

  // Delete an edge/relationship by id
  app.delete('/families/:id/edges/:edgeId', { preHandler: requireAuth }, async (req, reply) => {
    const familyId = (req.params as any).id as string;
    const edgeId = (req.params as any).edgeId as string;
    const driver = getDriver();
    const session = driver.session();
    try {
      const res = await session.executeWrite((tx) =>
        tx.run(
          `MATCH (a:Person)-[r:SPOUSE_OF|PARENT_OF]->(b:Person)
           WHERE r.id = $edgeId
             AND (a)-[:MEMBER_OF]->(:Family { id: $familyId })
             AND (b)-[:MEMBER_OF]->(:Family { id: $familyId })
           DELETE r
           RETURN $edgeId as id`,
          { familyId, edgeId }
        )
      );
      const deletedId = res.records[0]?.get('id');
      getIO()?.to(familyId).emit('edge:deleted', { id: deletedId });
      return reply.code(204).send();
    } finally {
      await session.close();
    }
  });

  // Get chat messages for a family
  app.get('/families/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    const familyId = (req.params as any).id as string;
    const limit = Number((req.query as any)?.limit ?? 50);
    const driver = getDriver();
    const session = driver.session();
    try {
      const res = await session.executeRead((tx) =>
        tx.run(
          `MATCH (f:Family { id: $familyId })<-[:IN]-(m:Message)
           RETURN m
           ORDER BY m.createdAt DESC
           LIMIT $limit`,
          { familyId, limit }
        )
      );
      const messages = res.records
        .map((r) => r.get('m').properties)
        .map((m: any) => ({
          id: m.id,
          text: m.text,
          userId: m.userId,
          userName: m.userName,
          createdAt: m.createdAt,
        }))
        .reverse();
      return { messages };
    } finally {
      await session.close();
    }
  });

  // Post a chat message to a family and broadcast
  app.post('/families/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    const familyId = (req.params as any).id as string;
    const userId = req.user!.sub;
    const body = createMessageSchema.parse(req.body as unknown);
    const driver = getDriver();
    const session = driver.session();
    try {
      const res = await session.executeWrite((tx) =>
        tx.run(
          `MATCH (f:Family { id: $familyId })
           MATCH (u:Person { id: $userId })
           CREATE (m:Message {
             id: randomUUID(), text: $text, userId: $userId, userName: coalesce(u.name, 'User'), createdAt: datetime() })-[:IN]->(f)
           RETURN m`,
          { familyId, userId, text: body.text }
        )
      );
      const m = res.records[0]?.get('m').properties;
      const message = { id: m.id, text: m.text, userId: m.userId, userName: m.userName, createdAt: m.createdAt };
      getIO()?.to(familyId).emit('chat:message', message);
      return reply.code(201).send({ message });
    } finally {
      await session.close();
    }
  });
}
