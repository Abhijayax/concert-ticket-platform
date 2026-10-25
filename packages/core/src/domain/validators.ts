import { z } from "zod";

export const bookingRequestSchema = z
  .object({
    eventId: z.string().min(1),
    seatIds: z.array(z.string().min(1)).min(1).max(4),
  })
  .strict()
  .refine((request) => new Set(request.seatIds).size === request.seatIds.length, {
    message: "Seat IDs must be unique",
  });

export const idempotencyKeySchema = z.string().min(8).max(64);

export const eventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().min(1),
  venue: z.string().min(1),
  startsAt: z.string().datetime(),
  saleStartsAt: z.string().datetime(),
  currency: z.string().length(3),
  organizerId: z.string().min(1),
  organizerEmail: z.string().email(),
  totalSeats: z.number().int().positive().max(5000),
  soldOutNotified: z.boolean(),
  createdAt: z.string().datetime(),
});
