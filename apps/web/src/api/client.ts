export interface ConcertEvent {
  id: string;
  title: string;
  artist: string;
  venue: string;
  startsAt: string;
  saleStartsAt: string;
  currency: string;
  totalSeats: number;
}

export interface Seat {
  id: string;
  eventId: string;
  section: string;
  row: number;
  number: number;
  price: number;
  status: "AVAILABLE" | "BOOKED";
}

export interface Booking {
  id: string;
  eventId: string;
  seatIds: string[];
  status: "QUEUED" | "CONFIRMED" | "FAILED";
  failureReason?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

export interface Session {
  token: string;
  username: string;
  email: string;
  role: "user" | "admin";
}

// Session token lives in sessionStorage (cleared when the tab closes).
let session: Session | null = (() => {
  try {
    return JSON.parse(sessionStorage.getItem("session") ?? "null") as Session | null;
  } catch {
    return null;
  }
})();

export const getSession = (): Session | null => session;
export function clearSession(): void {
  session = null;
  sessionStorage.removeItem("session");
}

async function request<T>(path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: { code?: string; message?: string };
  };
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data.error?.code ?? "ERROR",
      data.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return { status: res.status, data };
}

export interface AdminOverview {
  system: { startedAt: string; queueBackend: string; dataStore: string; queueDepth: number | null };
  bookings: { total: number; QUEUED: number; CONFIRMED: number; FAILED: number };
  events: { id: string; title: string; totalSeats: number; booked: number; available: number }[];
}

export interface ActivityEntry {
  at: string;
  type: string;
  actor: string;
  detail?: string;
}

export const api = {
  async login(username: string, password: string): Promise<Session> {
    const { data } = await request<{
      token: string;
      user: { username: string; email: string; role: "user" | "admin" };
    }>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    session = { token: data.token, ...data.user };
    sessionStorage.setItem("session", JSON.stringify(session));
    return session;
  },
  async adminOverview(): Promise<AdminOverview> {
    return (await request<AdminOverview>("/console/overview")).data;
  },
  async adminBookings(): Promise<(Booking & { userId: string; createdAt: string })[]> {
    return (
      await request<{ bookings: (Booking & { userId: string; createdAt: string })[] }>(
        "/console/bookings",
      )
    ).data.bookings;
  },
  async adminActivity(): Promise<ActivityEntry[]> {
    return (await request<{ entries: ActivityEntry[] }>("/console/activity")).data.entries;
  },
  async events(): Promise<ConcertEvent[]> {
    return (await request<{ events: ConcertEvent[] }>("/events")).data.events;
  },
  async seats(eventId: string): Promise<Seat[]> {
    return (await request<{ seats: Seat[] }>(`/events/${eventId}/seats`)).data.seats;
  },
  async book(eventId: string, seatIds: string[], idempotencyKey: string) {
    const { status, data } = await request<{ booking: Booking }>("/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ eventId, seatIds }),
    });
    return { status, booking: data.booking };
  },
  async booking(id: string): Promise<Booking> {
    return (await request<{ booking: Booking }>(`/bookings/${id}`)).data.booking;
  },
  async myBookings(): Promise<Booking[]> {
    return (await request<{ bookings: Booking[] }>("/me/bookings")).data.bookings;
  },
  // Local development only: the API rejects this outside NODE_ENV=development.
  async devProcess(bookingId: string): Promise<Booking> {
    return (
      await request<{ booking: Booking }>("/dev/process-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      })
    ).data.booking;
  },
};
