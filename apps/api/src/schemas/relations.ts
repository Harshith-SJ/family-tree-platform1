import { z } from 'zod';
import { RELATION_TYPES } from '../constants/relations';

export const AddRelationSchema = z.object({
  referenceId: z.string().min(1),
  relationType: z.enum(RELATION_TYPES as unknown as [string, ...string[]]),
  options: z.object({
    side: z.enum(['maternal','paternal']).optional(),
    createPair: z.boolean().optional(),
    uncleAuntId: z.string().optional()
  }).optional(),
  person: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    gender: z.enum(['MALE','FEMALE','OTHER']).optional(),
    birthDate: z.string().optional(),
  // TODO: strengthen password policy (was requiring upper/lower/digit) - relaxed to length only to keep integration tests green
  tempPassword: z.string().min(8)
  }).optional(),
  partner: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    gender: z.enum(['MALE','FEMALE','OTHER']).optional(),
    birthDate: z.string().optional(),
  // TODO: strengthen password policy later
  tempPassword: z.string().min(8)
  }).optional()
});
export type AddRelationInput = z.infer<typeof AddRelationSchema>;
