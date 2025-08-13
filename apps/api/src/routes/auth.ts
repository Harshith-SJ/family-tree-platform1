import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { signToken, verifyToken } from '../lib/jwt';
import { getDriver } from '../lib/neo4j';

const signupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  birthDate: z.string().optional(),
  familyName: z.string().min(2).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/signup', async (req, reply) => {
    const body = signupSchema.parse(req.body as unknown);
    const driver = getDriver();
    const session = driver.session();
    const hashed = await bcrypt.hash(body.password, 10);

    try {
      const result = await session.executeWrite((tx) =>
        tx.run(
          `MERGE (u:Person { email: $email })
           ON CREATE SET u.id = randomUUID(), u.name = $name, u.password = $password, u.createdAt = datetime(),
                         u.gender = $gender, u.birthDate = $birthDate
           WITH u
           MERGE (f:Family { id: coalesce(u.familyId, randomUUID()) })
           ON CREATE SET f.name = coalesce($familyName, $defaultFamilyName), f.createdAt = datetime()
           MERGE (u)-[:MEMBER_OF]->(f)
           RETURN u{.*, familyId: f.id} as user`,
          {
            email: body.email, name: body.name, password: hashed,
            gender: body.gender ?? null, birthDate: body.birthDate ?? null,
            familyName: body.familyName ?? null,
            defaultFamilyName: `${body.name.split(' ')[0]}'s Family`,
          }
        )
      );

      const user = result.records[0]?.get('user');
      if (!user) return reply.code(500).send({ message: 'Signup failed' });

      const token = signToken({ sub: user.id, email: body.email });
      reply
        .setCookie('token', token, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' })
        .code(201)
        .send({ user: { id: user.id, name: user.name, email: body.email, familyId: user.familyId } });
    } finally {
      await session.close();
    }
  });

  app.post('/login', async (req, reply) => {
    const body = loginSchema.parse(req.body as unknown);
    const driver = getDriver();
    const session = driver.session();

    try {
      const result = await session.executeRead((tx) =>
        tx.run(`MATCH (u:Person { email: $email }) RETURN u LIMIT 1`, { email: body.email })
      );
      const node = result.records[0]?.get('u');
      const props = node?.properties as any;
      if (!props) return reply.code(401).send({ message: 'Invalid credentials' });

      const ok = await bcrypt.compare(body.password, props.password);
      if (!ok) return reply.code(401).send({ message: 'Invalid credentials' });

      const token = signToken({ sub: props.id, email: props.email });
      reply
        .setCookie('token', token, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' })
        .send({ user: { id: props.id, name: props.name, email: props.email } });
    } finally {
      await session.close();
    }
  });

  app.get('/me', async (req, reply) => {
    const token = (req.cookies as any)?.token as string | undefined;
    if (!token) return reply.code(401).send({ message: 'Unauthorized' });
    try {
      const payload = verifyToken(token);
      return { user: payload };
    } catch {
      return reply.code(401).send({ message: 'Unauthorized' });
    }
  });

  app.route({
    method: ['POST', 'GET'],
    url: '/logout',
    handler: async (_req, reply) => {
      reply.clearCookie('token', { path: '/' }).send({ ok: true });
    }
  });
}
