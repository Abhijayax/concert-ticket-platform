import type { Booking, ConcertEvent, Seat } from "../domain/types.js";

export interface SeatStore {
  getByEvent(eventId: string): Promise<Seat[]>;

  /**
   * Claims every requested seat or claims none.
   * A seat already booked by this booking counts as success for retry safety.
   */
  claimSeats(
    eventId: string,
    seatIds: string[],
    bookingId: string,
    userId: string,
    bookedAt: string,
  ): Promise<void>;

  releaseSeats(bookingId: string): Promise<void>;
}

export interface BookingStore {
  getById(bookingId: string): Promise<Booking | undefined>;

  create(booking: Booking): Promise<"CREATED" | "EXISTS">;

  update(booking: Booking): Promise<void>;

  listByUser(userId: string): Promise<Booking[]>;

  listAll(): Promise<Booking[]>;
}

export interface EventStore {
  getById(eventId: string): Promise<ConcertEvent | undefined>;

  create(event: ConcertEvent): Promise<void>;

  listAll(): Promise<ConcertEvent[]>;

  update(event: ConcertEvent): Promise<void>;
}

export interface QueueMessage {
  bookingId: string;
  userId: string;
  userEmail: string;
  eventId: string;
  seatIds: string[];
}

export interface Queue {
  send(message: QueueMessage): Promise<void>;
  depth(): Promise<number>;
}

export interface EventBus {
  publish(event: {
    type: "BookingConfirmed" | "BookingFailed" | "EventSoldOut";
    bookingId?: string;
    eventId: string;
    userId?: string;
    reason?: string;
  }): Promise<void>;
}

export interface Mailer {
  send(message: { to: string; subject: string; body: string }): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface BookingDependencies {
  bookings: BookingStore;
  seats: SeatStore;
  events: EventStore;
  queue: Queue;
  eventBus: EventBus;
  clock: Clock;
  assumedThroughputPerSecond: number;
  maxSeatsPerBooking: number;
  maxSeatsPerUserPerEvent: number;
}
