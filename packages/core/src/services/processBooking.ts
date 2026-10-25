import { DomainError } from "../domain/types.js";
import type { Booking, FailureReason } from "../domain/types.js";
import type { BookingDependencies, QueueMessage } from "../ports/index.js";

async function failBooking(
  booking: Booking,
  reason: FailureReason,
  deps: BookingDependencies,
): Promise<void> {
  await deps.seats.releaseSeats(booking.id);

  const failed: Booking = {
    ...booking,
    status: "FAILED",
    failureReason: reason,
    processedAt: deps.clock.now().toISOString(),
  };

  await deps.bookings.update(failed);

  await deps.eventBus.publish({
    type: "BookingFailed",
    bookingId: booking.id,
    eventId: booking.eventId,
    userId: booking.userId,
    reason,
  });
}

export async function processBooking(
  message: QueueMessage,
  deps: BookingDependencies,
): Promise<void> {
  const booking = await deps.bookings.getById(message.bookingId);

  if (!booking || booking.status !== "QUEUED") {
    return;
  }

  const event = await deps.events.getById(booking.eventId);

  if (!event) {
    await failBooking(booking, "SYSTEM_ERROR", deps);
    return;
  }

  if (deps.clock.now().getTime() < new Date(event.saleStartsAt).getTime()) {
    await failBooking(booking, "EVENT_NOT_ON_SALE", deps);
    return;
  }

  // Enforce the per-user cap at processing time. Exclude this booking,
  // but count other QUEUED and CONFIRMED bookings for this event.
  const userBookings = await deps.bookings.listByUser(booking.userId);

  const seatsAlreadyCommitted = userBookings
    .filter(
      (item) =>
        item.id !== booking.id &&
        item.eventId === booking.eventId &&
        (item.status === "QUEUED" || item.status === "CONFIRMED"),
    )
    .reduce((total, item) => total + item.seatIds.length, 0);

  if (seatsAlreadyCommitted + booking.seatIds.length > deps.maxSeatsPerUserPerEvent) {
    await failBooking(booking, "SEAT_LIMIT_EXCEEDED", deps);
    return;
  }

  try {
    await deps.seats.claimSeats(
      booking.eventId,
      booking.seatIds,
      booking.id,
      booking.userId,
      deps.clock.now().toISOString(),
    );
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "";

    if (messageText === "SEAT_UNAVAILABLE") {
      await failBooking(booking, "SEAT_UNAVAILABLE", deps);
      return;
    }

    if (messageText === "SEAT_NOT_FOUND") {
      await failBooking(booking, "SEAT_NOT_FOUND", deps);
      return;
    }

    // Unexpected storage failures must escape so a real queue-triggered
    // Azure Function can retry the message.
    throw error;
  }

  // Persist confirmation before publishing. If publishing fails, the queue
  // may redeliver the message; confirmed bookings become an idempotent no-op.
  const confirmed: Booking = {
    ...booking,
    status: "CONFIRMED",
    processedAt: deps.clock.now().toISOString(),
  };

  await deps.bookings.update(confirmed);

  await deps.eventBus.publish({
    type: "BookingConfirmed",
    bookingId: booking.id,
    eventId: booking.eventId,
    userId: booking.userId,
  });
}

export async function processDeadLetter(
  bookingId: string,
  deps: BookingDependencies,
): Promise<void> {
  const booking = await deps.bookings.getById(bookingId);

  if (!booking || booking.status !== "QUEUED") {
    return;
  }

  await failBooking(booking, "SYSTEM_ERROR", deps);
}

export function asDomainError(error: unknown): DomainError {
  if (error instanceof DomainError) {
    return error;
  }

  return new DomainError("SYSTEM_ERROR", "An unexpected error occurred", 500);
}
