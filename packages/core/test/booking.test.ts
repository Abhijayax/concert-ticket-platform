import { beforeEach, describe, expect, it } from "vitest";

import {
  DomainError,
  FixedClock,
  MemoryBookingStore,
  MemoryEventBus,
  MemoryEventStore,
  MemoryQueue,
  MemorySeatStore,
  makeBookingId,
  makeRequestHash,
  processBooking,
  submitBooking,
  type BookingDependencies,
  type ConcertEvent,
  type Seat,
} from "../src/index.js";

describe("booking core", () => {
  let deps: BookingDependencies;
  let event: ConcertEvent;

  beforeEach(async () => {
    const clock = new FixedClock(new Date("2030-01-01T12:00:00.000Z"));
    const events = new MemoryEventStore();
    const seats = new MemorySeatStore();

    event = {
      id: "event-1",
      title: "Test Concert",
      artist: "Test Artist",
      venue: "Test Venue",
      startsAt: "2030-02-01T19:00:00.000Z",
      saleStartsAt: "2030-01-01T10:00:00.000Z",
      currency: "USD",
      organizerId: "organizer-1",
      organizerEmail: "organizer@example.com",
      totalSeats: 3,
      soldOutNotified: false,
      createdAt: "2030-01-01T09:00:00.000Z",
    };

    await events.create(event);

    const seededSeats: Seat[] = [1, 2, 3].map((number) => ({
      id: `A-1-${number}`,
      eventId: event.id,
      section: "A",
      row: 1,
      number,
      price: 50,
      status: "AVAILABLE",
    }));

    seats.seed(seededSeats);

    deps = {
      bookings: new MemoryBookingStore(),
      seats,
      events,
      queue: new MemoryQueue(),
      eventBus: new MemoryEventBus(),
      clock,
      assumedThroughputPerSecond: 50,
      maxSeatsPerBooking: 4,
      maxSeatsPerUserPerEvent: 4,
    };
  });

  it("generates deterministic booking IDs", () => {
    expect(makeBookingId("user-1", "key-12345")).toBe(makeBookingId("user-1", "key-12345"));

    expect(makeBookingId("user-1", "key-12345")).not.toBe(makeBookingId("user-2", "key-12345"));
  });

  it("generates the same request hash regardless of seat order", () => {
    expect(makeRequestHash("event-1", ["A-1-1", "A-1-2"])).toBe(
      makeRequestHash("event-1", ["A-1-2", "A-1-1"]),
    );
  });

  it("queues a booking and returns 202", async () => {
    const result = await submitBooking(
      {
        userId: "user-1",
        userEmail: "user1@example.com",
        eventId: event.id,
        seatIds: ["A-1-1"],
        idempotencyKey: "key-12345",
      },
      deps,
    );

    expect(result.httpStatus).toBe(202);
    expect(result.booking.status).toBe("QUEUED");
    expect(result.booking.enqueuedAt).toBeDefined();
  });

  it("replays the same idempotency key without creating another queue message", async () => {
    const request = {
      userId: "user-1",
      userEmail: "user1@example.com",
      eventId: event.id,
      seatIds: ["A-1-1"],
      idempotencyKey: "key-12345",
    };

    const first = await submitBooking(request, deps);
    const second = await submitBooking(request, deps);

    expect(first.booking.id).toBe(second.booking.id);
    expect(first.httpStatus).toBe(202);
    expect(second.httpStatus).toBe(200);
    expect(await deps.queue.depth()).toBe(1);
  });

  it("rejects reuse of an idempotency key with a different payload", async () => {
    const request = {
      userId: "user-1",
      userEmail: "user1@example.com",
      eventId: event.id,
      seatIds: ["A-1-1"],
      idempotencyKey: "key-12345",
    };

    await submitBooking(request, deps);

    await expect(submitBooking({ ...request, seatIds: ["A-1-2"] }, deps)).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      statusCode: 422,
    });
  });

  it("rejects bookings before the sale starts", async () => {
    await deps.events.update({
      ...event,
      saleStartsAt: "2030-01-01T13:00:00.000Z",
    });

    await expect(
      submitBooking(
        {
          userId: "user-1",
          userEmail: "user1@example.com",
          eventId: event.id,
          seatIds: ["A-1-1"],
          idempotencyKey: "key-12345",
        },
        deps,
      ),
    ).rejects.toMatchObject({
      code: "SALE_NOT_OPEN",
      statusCode: 409,
    });
  });

  it("confirms a booking when its seats are available", async () => {
    const result = await submitBooking(
      {
        userId: "user-1",
        userEmail: "user1@example.com",
        eventId: event.id,
        seatIds: ["A-1-1"],
        idempotencyKey: "key-12345",
      },
      deps,
    );

    await processBooking(
      {
        bookingId: result.booking.id,
        userId: "user-1",
        userEmail: "user1@example.com",
        eventId: event.id,
        seatIds: ["A-1-1"],
      },
      deps,
    );

    const booking = await deps.bookings.getById(result.booking.id);
    const seats = await deps.seats.getByEvent(event.id);

    expect(booking?.status).toBe("CONFIRMED");
    expect(seats.find((seat) => seat.id === "A-1-1")?.bookingId).toBe(result.booking.id);
  });

  it("never sells the same seat to two competing bookings", async () => {
    const requests = await Promise.all(
      ["user-1", "user-2"].map((userId) =>
        submitBooking(
          {
            userId,
            userEmail: `${userId}@example.com`,
            eventId: event.id,
            seatIds: ["A-1-1"],
            idempotencyKey: `key-${userId}-12345`,
          },
          deps,
        ),
      ),
    );

    await Promise.all(
      requests.map((result) =>
        processBooking(
          {
            bookingId: result.booking.id,
            userId: result.booking.userId,
            userEmail: result.booking.userEmail,
            eventId: event.id,
            seatIds: result.booking.seatIds,
          },
          deps,
        ),
      ),
    );

    const bookings = await deps.bookings.listAll();
    const seat = (await deps.seats.getByEvent(event.id)).find((item) => item.id === "A-1-1");

    expect(bookings.filter((booking) => booking.status === "CONFIRMED")).toHaveLength(1);
    expect(bookings.filter((booking) => booking.status === "FAILED")).toHaveLength(1);
    expect(seat?.status).toBe("BOOKED");
  });

  it("claims multiple seats all-or-nothing", async () => {
    await deps.seats.claimSeats(
      event.id,
      ["A-1-1"],
      "booking-existing",
      "user-existing",
      "2030-01-01T12:00:00.000Z",
    );

    await expect(
      deps.seats.claimSeats(
        event.id,
        ["A-1-2", "A-1-1"],
        "booking-new",
        "user-new",
        "2030-01-01T12:00:00.000Z",
      ),
    ).rejects.toThrow("SEAT_UNAVAILABLE");

    const seats = await deps.seats.getByEvent(event.id);

    expect(seats.find((seat) => seat.id === "A-1-2")?.status).toBe("AVAILABLE");
  });

  it("treats an already-owned seat as a retry-safe success", async () => {
    await deps.seats.claimSeats(
      event.id,
      ["A-1-1"],
      "booking-existing",
      "user-existing",
      "2030-01-01T12:00:00.000Z",
    );

    await expect(
      deps.seats.claimSeats(
        event.id,
        ["A-1-1"],
        "booking-existing",
        "user-existing",
        "2030-01-01T12:01:00.000Z",
      ),
    ).resolves.toBeUndefined();
  });

  it("throws a domain error for a missing event", async () => {
    await expect(
      submitBooking(
        {
          userId: "user-1",
          userEmail: "user1@example.com",
          eventId: "missing-event",
          seatIds: ["A-1-1"],
          idempotencyKey: "key-12345",
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
