import assert from "node:assert/strict";
import {
  FixedClock,
  MemoryBookingStore,
  MemoryEventBus,
  MemoryEventStore,
  MemoryQueue,
  MemorySeatStore,
  processBooking,
  type Booking,
  type ConcertEvent,
  type QueueMessage,
  type Seat,
} from "../packages/core/src/index.js";

async function main(): Promise<void> {
  const now = new Date("2030-01-01T12:00:00.000Z");

  const event: ConcertEvent = {
    id: "invariant-event",
    title: "Invariant Test Concert",
    artist: "Test Artist",
    venue: "Test Venue",
    startsAt: "2030-02-01T18:00:00.000Z",
    saleStartsAt: "2030-01-01T00:00:00.000Z",
    currency: "INR",
    organizerId: "organizer-1",
    organizerEmail: "organizer@example.com",
    totalSeats: 10,
    soldOutNotified: false,
    createdAt: now.toISOString(),
  };

  const deps = {
    seats: new MemorySeatStore(),
    bookings: new MemoryBookingStore(),
    events: new MemoryEventStore(),
    queue: new MemoryQueue(),
    eventBus: new MemoryEventBus(),
    clock: new FixedClock(now),
    assumedThroughputPerSecond: 10,
    maxSeatsPerBooking: 4,
    maxSeatsPerUserPerEvent: 4,
  };

  await deps.events.create(event);

  const seats: Seat[] = Array.from({ length: 10 }, (_, index) => ({
    id: `A-${index + 1}`,
    eventId: event.id,
    section: "GENERAL",
    row: 1,
    number: index + 1,
    price: 500,
    status: "AVAILABLE",
  }));

  deps.seats.seed(seats);

  function makeBooking(id: string, userId: string, seatIds: string[]): Booking {
    return {
      id,
      userId,
      userEmail: `${userId}@example.com`,
      eventId: event.id,
      seatIds,
      status: "QUEUED",
      requestHash: `hash-${id}`,
      createdAt: now.toISOString(),
      enqueuedAt: now.toISOString(),
    };
  }

  function messageFor(booking: Booking): QueueMessage {
    return {
      bookingId: booking.id,
      userId: booking.userId,
      userEmail: booking.userEmail,
      eventId: booking.eventId,
      seatIds: booking.seatIds,
    };
  }

  // 1. Two users compete for the same seat.
  const first = makeBooking("booking-first", "user-first", ["A-1"]);
  const second = makeBooking("booking-second", "user-second", ["A-1"]);

  await deps.bookings.create(first);
  await deps.bookings.create(second);

  await Promise.all([
    processBooking(messageFor(first), deps),
    processBooking(messageFor(second), deps),
  ]);

  const firstResult = await deps.bookings.getById(first.id);
  const secondResult = await deps.bookings.getById(second.id);

  assert.ok(firstResult);
  assert.ok(secondResult);

  assert.equal(
    [firstResult, secondResult].filter((booking) => booking.status === "CONFIRMED").length,
    1,
    "Exactly one competing booking must confirm",
  );

  // 2. A failed multi-seat booking must not partially claim its free seat.
  const blocker = makeBooking("booking-blocker", "user-blocker", ["A-3"]);
  await deps.bookings.create(blocker);
  await processBooking(messageFor(blocker), deps);

  const multi = makeBooking("booking-multi", "user-multi", ["A-2", "A-3"]);
  await deps.bookings.create(multi);
  await processBooking(messageFor(multi), deps);

  const multiResult = await deps.bookings.getById(multi.id);
  assert.ok(multiResult);
  assert.equal(multiResult.status, "FAILED");

  const currentSeats = await deps.seats.getByEvent(event.id);
  const freeSeat = currentSeats.find((seat) => seat.id === "A-2");

  assert.ok(freeSeat);
  assert.equal(
    freeSeat.status,
    "AVAILABLE",
    "A-2 must remain available after the multi-seat claim fails",
  );

  // 3. Reprocessing a confirmed booking must not publish another confirmation.
  const confirmedId = firstResult.status === "CONFIRMED" ? first.id : second.id;

  const confirmationsBefore = deps.eventBus.published.filter(
    (item) => item.type === "BookingConfirmed",
  ).length;

  const confirmedBooking = await deps.bookings.getById(confirmedId);
  assert.ok(confirmedBooking);

  await processBooking(messageFor(confirmedBooking), deps);

  const confirmationsAfter = deps.eventBus.published.filter(
    (item) => item.type === "BookingConfirmed",
  ).length;

  assert.equal(
    confirmationsAfter,
    confirmationsBefore,
    "Reprocessing a confirmed booking must not publish another confirmation",
  );

  console.log("Invariant verification passed:");
  console.log("- Competing bookings cannot both confirm the same seat.");
  console.log("- Failed multi-seat claims do not leave partial reservations.");
  console.log("- Reprocessing a confirmed booking does not duplicate confirmation.");
}

main().catch((error: unknown) => {
  console.error("Invariant verification failed:", error);
  process.exitCode = 1;
});
