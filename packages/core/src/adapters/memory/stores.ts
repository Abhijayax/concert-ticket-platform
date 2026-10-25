import type { Booking, ConcertEvent, Seat } from "../../domain/types.js";

import type { BookingStore, EventStore, SeatStore } from "../../ports/index.js";

export class MemorySeatStore implements SeatStore {
  private readonly seats = new Map<string, Seat>();

  seed(seats: Seat[]): void {
    for (const seat of seats) {
      this.seats.set(`${seat.eventId}:${seat.id}`, { ...seat });
    }
  }

  async getByEvent(eventId: string): Promise<Seat[]> {
    return [...this.seats.values()]
      .filter((seat) => seat.eventId === eventId)
      .map((seat) => ({ ...seat }));
  }

  async claimSeats(
    eventId: string,
    seatIds: string[],
    bookingId: string,
    userId: string,
    bookedAt: string,
  ): Promise<void> {
    const requested = seatIds.map((id) => {
      const seat = this.seats.get(`${eventId}:${id}`);

      if (!seat) {
        throw new Error("SEAT_NOT_FOUND");
      }

      return seat;
    });

    // Retry-safe: every requested seat already belongs to this booking.
    if (requested.every((seat) => seat.status === "BOOKED" && seat.bookingId === bookingId)) {
      return;
    }

    // Reject the whole operation before changing any seat.
    if (requested.some((seat) => seat.status !== "AVAILABLE")) {
      throw new Error("SEAT_UNAVAILABLE");
    }

    // No await occurs between the validation and these mutations.
    for (const seat of requested) {
      this.seats.set(`${eventId}:${seat.id}`, {
        ...seat,
        status: "BOOKED",
        bookingId,
        bookedBy: userId,
        bookedAt,
      });
    }
  }

  async releaseSeats(bookingId: string): Promise<void> {
    for (const [key, seat] of this.seats.entries()) {
      if (seat.bookingId === bookingId) {
        const released = { ...seat };

        delete released.bookingId;
        delete released.bookedBy;
        delete released.bookedAt;

        this.seats.set(key, {
          ...released,
          status: "AVAILABLE",
        });
      }
    }
  }
}

export class MemoryBookingStore implements BookingStore {
  private readonly bookings = new Map<string, Booking>();

  async getById(bookingId: string): Promise<Booking | undefined> {
    const booking = this.bookings.get(bookingId);
    return booking ? structuredClone(booking) : undefined;
  }

  async create(booking: Booking): Promise<"CREATED" | "EXISTS"> {
    if (this.bookings.has(booking.id)) {
      return "EXISTS";
    }

    this.bookings.set(booking.id, structuredClone(booking));
    return "CREATED";
  }

  async update(booking: Booking): Promise<void> {
    if (!this.bookings.has(booking.id)) {
      throw new Error("BOOKING_NOT_FOUND");
    }

    this.bookings.set(booking.id, structuredClone(booking));
  }

  async listByUser(userId: string): Promise<Booking[]> {
    return [...this.bookings.values()]
      .filter((booking) => booking.userId === userId)
      .map((booking) => structuredClone(booking));
  }

  async listAll(): Promise<Booking[]> {
    return [...this.bookings.values()].map((booking) => structuredClone(booking));
  }
}

export class MemoryEventStore implements EventStore {
  private readonly events = new Map<string, ConcertEvent>();

  async getById(eventId: string): Promise<ConcertEvent | undefined> {
    const event = this.events.get(eventId);
    return event ? structuredClone(event) : undefined;
  }

  async create(event: ConcertEvent): Promise<void> {
    if (this.events.has(event.id)) {
      throw new Error("EVENT_ALREADY_EXISTS");
    }

    this.events.set(event.id, structuredClone(event));
  }

  async listAll(): Promise<ConcertEvent[]> {
    return [...this.events.values()].map((event) => structuredClone(event));
  }

  async update(event: ConcertEvent): Promise<void> {
    if (!this.events.has(event.id)) {
      throw new Error("EVENT_NOT_FOUND");
    }

    this.events.set(event.id, structuredClone(event));
  }
}
