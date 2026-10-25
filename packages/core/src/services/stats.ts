import type { BookingDependencies } from "../ports/index.js";

export async function getEventStats(
  eventId: string,
  deps: BookingDependencies,
): Promise<{
  seatsTotal: number;
  seatsAvailable: number;
  seatsBooked: number;
  queueDepth: number;
  deadLetterCount: number;
}> {
  const event = await deps.events.getById(eventId);

  if (!event) {
    throw new Error("EVENT_NOT_FOUND");
  }

  const seats = await deps.seats.getByEvent(eventId);

  return {
    seatsTotal: seats.length,
    seatsAvailable: seats.filter((seat) => seat.status === "AVAILABLE").length,
    seatsBooked: seats.filter((seat) => seat.status === "BOOKED").length,
    queueDepth: await deps.queue.depth(),
    // The in-memory queue has no dead-letter queue. The Azure implementation
    // will obtain this count from Service Bus runtime properties.
    deadLetterCount: 0,
  };
}
