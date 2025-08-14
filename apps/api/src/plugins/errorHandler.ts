import { FastifyInstance } from 'fastify';
import { AppError } from '../errors/AppError';
import { ZodError } from 'zod';

export async function errorHandlingPlugin(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ message: err.message, code: err.code });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        message: 'Validation failed',
        code: 'VALIDATION',
        issues: err.issues.map(i => ({ path: i.path, message: i.message }))
      });
    }
    // Map Neo4j unique constraint violations to DUPLICATE
    if ((err as any).code === 'Neo.ClientError.Schema.ConstraintValidationFailed') {
      return reply.code(409).send({ message: 'Duplicate value violates unique constraint', code: 'DUPLICATE' });
    }
    app.log.error(err);
    return reply.code(500).send({ message: 'Internal error', code: 'INTERNAL_ERROR' });
  });

  app.setNotFoundHandler((_req, reply) => {
    return reply.code(404).send({ message: 'Not found', code: 'NOT_FOUND' });
  });
}
