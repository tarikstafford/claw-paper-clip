import { z } from "zod";

export const createThreadSchema = z.object({
  agentId: z.string().uuid(),
  title: z.string().max(200).optional(),
});
export type CreateThread = z.infer<typeof createThreadSchema>;

export const sendMessageSchema = z.object({
  body: z.string().min(1).max(50000),
  telegramUpdateId: z.number().int().optional(),
});
export type SendMessage = z.infer<typeof sendMessageSchema>;
