import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getDriver } from '../lib/neo4j';
import { requireAuth } from '../middleware/auth';

const updateProfileSchema = z.object({
  name: z.string().min(2).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  birthDate: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8),
});

export async function registerProfileRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Get current user's profile
  app.get('/', async (req, reply) => {
    const userId = req.user!.sub;
    const driver = getDriver();
    const session = driver.session();
    try {
      const result = await session.executeRead((tx) =>
        tx.run(
          `MATCH (u:Person { id: $userId })
           RETURN u { .id, .name, .email, .gender, .birthDate } AS user`,
          { userId }
        )
      );
      const user = result.records[0]?.get('user');
      if (!user) return reply.code(404).send({ message: 'User not found' });
      return { user };
    } finally {
      await session.close();
    }
  });

  // Update profile fields (name, gender, birthDate)
  app.patch('/', async (req, reply) => {
    const body = updateProfileSchema.parse(req.body as unknown);
    const userId = req.user!.sub;
    const driver = getDriver();
    const session = driver.session();
    try {
      const result = await session.executeWrite((tx) =>
        tx.run(
          `MATCH (u:Person { id: $userId })
           SET u.name = coalesce($name, u.name),
               u.gender = coalesce($gender, u.gender),
               u.birthDate = coalesce($birthDate, u.birthDate)
           RETURN u { .id, .name, .email, .gender, .birthDate } AS user`,
          { userId, name: body.name ?? null, gender: body.gender ?? null, birthDate: body.birthDate ?? null }
        )
      );
      const user = result.records[0]?.get('user');
      return { user };
    } finally {
      await session.close();
    }
  });

  // Change password
  app.post('/password', async (req, reply) => {
    const body = changePasswordSchema.parse(req.body as unknown);
    const userId = req.user!.sub;
    const driver = getDriver();
    const session = driver.session();
    try {
      // Get current hashed password
      const res = await session.executeRead((tx) =>
        tx.run(`MATCH (u:Person { id: $userId }) RETURN u LIMIT 1`, { userId })
      );
      const node = res.records[0]?.get('u');
      const props = node?.properties as any;
      if (!props) return reply.code(404).send({ message: 'User not found' });

      const ok = await bcrypt.compare(body.currentPassword, props.password);
      if (!ok) return reply.code(400).send({ message: 'Current password is incorrect' });

      const hashed = await bcrypt.hash(body.newPassword, 10);
      await session.executeWrite((tx) =>
        tx.run(`MATCH (u:Person { id: $userId }) SET u.password = $password RETURN u.id`, { userId, password: hashed })
      );
      return { ok: true };
    } finally {
      await session.close();
    }
  });
}
