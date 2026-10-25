import { bookingRequestSchema, idempotencyKeySchema } from "../domain/validators.js";
import { DomainError } from "../domain/types.js";
import type { Booking, BookingRequest } from "../domain/types.js";
import type { BookingDependencies } from "../ports/index.js";
import { makeBookingId, makeRequestHash } from "./hash.js";

export async function submitBooking(
  request: BookingRequest,
  deps: BookingDependencies,
): Promise<{ booking: Booking; httpStatus: 200 | 202 }> {
  const parsed = bookingRequestSchema.safeParse({
    eventId: request.eventId,
    seatIds: request.seatIds,
  });

  if (
    !parsed.success ||
    !idempotencyKeySchema.safeParse(request.idempotencyKey).success ||
    !request.userId ||
    !request.userEmail
  ) {
    throw new DomainError("INVALID_REQUEST", "Invalid booking request", 400);
  }

  if (request.seatIds.length > deps.maxSeatsPerBooking) {
    throw new DomainError(
      "INVALID_REQUEST",
      `A maximum of ${deps.maxSeatsPerBooking} seats may be booked at once`,
      400,
    );
  }

  const bookingId = makeBookingId(request.userId, request.idempotencyKey);
  const requestHash = makeRequestHash(request.eventId, request.seatIds);

  const event = await deps.events.getById(request.eventId);

  if (!event) {
    throw new DomainError("EVENT_NOT_FOUND", "Event not found", 404);
  }

  const now = deps.clock.now();

  if (now.getTime() < new Date(event.saleStartsAt).getTime()) {
    throw new DomainError("SALE_NOT_OPEN", "Ticket sales have not started", 409);
  }

  if (event.soldOutAt) {
    throw new DomainError("SOLD_OUT", "This event is sold out", 409);
  }

  const existing = await deps.bookings.getById(bookingId);

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new DomainError(
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used for a different request",
        422,
      );
    }

    if (existing.enqueuedAt) {
      return { booking: existing, httpStatus: 200 };
    }
  } else {
    const booking: Booking = {
      id: bookingId,
      userId: request.userId,
      userEmail: request.userEmail,
      eventId: request.eventId,
      seatIds: [...request.seatIds],
      status: "QUEUED",
      requestHash,
      createdAt: now.toISOString(),
    };

    const created = await deps.bookings.create(booking);

    if (created === "EXISTS") {
      const raced = await deps.bookings.getById(bookingId);

      if (!raced) {
        throw new DomainError("SYSTEM_ERROR", "Booking creation could not be verified", 503);
      }

      if (raced.requestHash !== requestHash) {
        throw new DomainError(
          "IDEMPOTENCY_KEY_REUSED",
          "This idempotency key was already used for a different request",
          422,
        );
      }

      if (raced.enqueuedAt) {
        return { booking: raced, httpStatus: 200 };
      }
    }
  }

  // If sending fails, enqueuedAt remains unset. A retry with the same key
  // can safely try to send again.
  // Any queue failure (depth lookup or send) is reported as a retryable 503; never as queued.
  let depth: number;
  let estimatedWaitSeconds: number;

  try {
    depth = await deps.queue.depth();
    estimatedWaitSeconds = Math.ceil(depth / Math.max(1, deps.assumedThroughputPerSecond));
    await deps.queue.send({
      bookingId,
      userId: request.userId,
      userEmail: request.userEmail,
      eventId: request.eventId,
      seatIds: [...request.seatIds],
    });
  } catch {
    throw new DomainError(
      "SERVICE_BUSY",
      "The booking could not be queued. Retry with the same Idempotency-Key.",
      503,
    );
  }

  const current = await deps.bookings.getById(bookingId);

  if (!current) {
    throw new DomainError("SYSTEM_ERROR", "Booking record disappeared", 503);
  }

  const updated: Booking = {
    ...current,
    enqueuedAt: deps.clock.now().toISOString(),
    queueDepthAtEnqueue: depth,
    estimatedWaitSeconds,
  };

  await deps.bookings.update(updated);

  return { booking: updated, httpStatus: 202 };
}
