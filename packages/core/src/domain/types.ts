export type BookingStatus = "QUEUED" | "CONFIRMED" | "FAILED";

export type SeatStatus = "AVAILABLE" | "BOOKED";

export type EventStatus = "SCHEDULED" | "ON_SALE" | "SOLD_OUT";

export type FailureReason =
  | "SEAT_UNAVAILABLE"
  | "SEAT_NOT_FOUND"
  | "EVENT_NOT_ON_SALE"
  | "SEAT_LIMIT_EXCEEDED"
  | "INVALID_REQUEST"
  | "SYSTEM_ERROR";

export interface ConcertEvent {
  id: string;
  title: string;
  artist: string;
  venue: string;
  startsAt: string;
  saleStartsAt: string;
  currency: string;
  organizerId: string;
  organizerEmail: string;
  totalSeats: number;
  soldOutAt?: string;
  soldOutNotified: boolean;
  createdAt: string;
}

export interface Seat {
  id: string;
  eventId: string;
  section: string;
  row: number;
  number: number;
  price: number;
  status: SeatStatus;
  bookingId?: string;
  bookedBy?: string;
  bookedAt?: string;
}

export interface Booking {
  id: string;
  userId: string;
  userEmail: string;
  eventId: string;
  seatIds: string[];
  status: BookingStatus;
  requestHash: string;
  createdAt: string;
  enqueuedAt?: string;
  processedAt?: string;
  failureReason?: FailureReason;
  queueDepthAtEnqueue?: number;
  estimatedWaitSeconds?: number;
}

export interface BookingRequest {
  userId: string;
  userEmail: string;
  eventId: string;
  seatIds: string[];
  idempotencyKey: string;
}

export interface BookingAccepted {
  bookingId: string;
  status: "QUEUED";
  queueDepthAtEnqueue: number;
  estimatedWaitSeconds: number;
}

export interface BookingError {
  code: string;
  message: string;
  statusCode: number;
}

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
