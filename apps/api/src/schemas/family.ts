import { z } from 'zod';

export const CreateFamilySchema = z.object({ name: z.string().min(2) });
export const UpsertPersonSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  email: z.string().email().optional(),
  posX: z.number().optional(),
  posY: z.number().optional(),
  gender: z.enum(['MALE','FEMALE','OTHER']).optional(),
  birthDate: z.string().optional(),
  deathDate: z.string().optional(),
  notes: z.string().optional(),
  tempPassword: z.string().min(8).optional(),
});
export const UpdatePositionSchema = z.object({ posX: z.number(), posY: z.number() });
export const CreateEdgeSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  type: z.enum(['SPOUSE','MOTHER','FATHER','SON','DAUGHTER']),
  label: z.string().optional()
});
export const CreateMessageSchema = z.object({ text: z.string().min(1).max(2000) });

export type CreateFamilyInput = z.infer<typeof CreateFamilySchema>;
export type UpsertPersonInput = z.infer<typeof UpsertPersonSchema>;
export type UpdatePositionInput = z.infer<typeof UpdatePositionSchema>;
export type CreateEdgeInput = z.infer<typeof CreateEdgeSchema>;
export type CreateMessageInput = z.infer<typeof CreateMessageSchema>;
