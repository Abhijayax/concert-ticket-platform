import { createCosmosStores } from "./adapters/azure/cosmosStores.js";
import { createServiceBusAdapters } from "./adapters/azure/serviceBus.js";

import {
  SystemClock,
  MemoryBookingStore,
  MemoryEventBus,
  MemoryEventStore,
  MemoryQueue,
  MemorySeatStore,
  processBooking,
  submitBooking,
  type BookingDependencies,
  type ConcertEvent,
  type EventBus,
  type Queue,
  type Seat,
} from "@tix/core";

const demoEvents: ConcertEvent[] = [
  {
    id: "evt_indie_night",
    title: "Indie Night Live",
    artist: "The Midnight Echoes",
    venue: "Coastal Arena",
    startsAt: "2026-11-15T18:30:00.000Z",
    saleStartsAt: "2026-10-01T00:00:00.000Z",
    currency: "INR",
    organizerId: "local-demo-organizer",
    organizerEmail: "organizer@example.com",
    totalSeats: 12,
    soldOutNotified: false,
    createdAt: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "evt_acoustic_evening",
    title: "Acoustic Evening",
    artist: "The Paper Moons",
    venue: "Harbour Auditorium",
    startsAt: "2026-12-05T17:30:00.000Z",
    saleStartsAt: "2026-10-01T00:00:00.000Z",
    currency: "INR",
    organizerId: "local-demo-organizer",
    organizerEmail: "organizer@example.com",
    totalSeats: 12,
    soldOutNotified: false,
    createdAt: "2026-10-01T00:00:00.000Z",
  },
];

const demoSeats: Seat[] = demoEvents.flatMap((event) =>
  Array.from({ length: event.totalSeats }, (_, index) => ({
    id: `${event.id}_seat_${index + 1}`,
    eventId: event.id,
    section: index < 6 ? "A" : "B",
    row: Math.floor(index / 6) + 1,
    number: (index % 6) + 1,
    price: index < 6 ? 999 : 699,
    status: "AVAILABLE" as const,
  })),
);

const memoryBookings = new MemoryBookingStore();
const memoryEvents = new MemoryEventStore();
const memorySeats = new MemorySeatStore();

// When SERVICEBUS_NAMESPACE is set, use real Azure Service Bus (Entra auth).
// Otherwise fall back to in-memory adapters for local development and tests.
const serviceBusNamespace = process.env.SERVICEBUS_NAMESPACE?.trim();
const serviceBus = serviceBusNamespace
  ? createServiceBusAdapters({
      namespace: serviceBusNamespace,
      queueName: process.env.SERVICEBUS_QUEUE?.trim() || "booking-requests",
      // Topic is optional: the Basic tier has no topics, so events stay in-memory.
      topicName: process.env.SERVICEBUS_TOPIC?.trim() || undefined,
    })
  : undefined;

export const usingServiceBus = serviceBus !== undefined;
export const queue: Queue = serviceBus?.queue ?? new MemoryQueue();
export const eventBus: EventBus = serviceBus?.eventBus ?? new MemoryEventBus();

const clock = new SystemClock();

const cosmosEndpoint = process.env.COSMOS_ENDPOINT?.trim();
const cosmosDatabase = process.env.COSMOS_DATABASE?.trim() || "ticketing";

const memoryStores = {
  bookings: memoryBookings,
  events: memoryEvents,
  seats: memorySeats,
};

export const runtimeStores = cosmosEndpoint
  ? createCosmosStores(cosmosEndpoint, cosmosDatabase)
  : Promise.resolve({
      bookings: memoryStores.bookings,
      events: memoryStores.events,
      seats: memoryStores.seats,
    });

export const bookings = {
  getById: async (...args: Parameters<typeof memoryBookings.getById>) =>
    (await runtimeStores).bookings.getById(...args),
  create: async (...args: Parameters<typeof memoryBookings.create>) =>
    (await runtimeStores).bookings.create(...args),
  update: async (...args: Parameters<typeof memoryBookings.update>) =>
    (await runtimeStores).bookings.update(...args),
  listByUser: async (...args: Parameters<typeof memoryBookings.listByUser>) =>
    (await runtimeStores).bookings.listByUser(...args),
  listAll: async (...args: Parameters<typeof memoryBookings.listAll>) =>
    (await runtimeStores).bookings.listAll(...args),
};

export const events = {
  getById: async (...args: Parameters<typeof memoryEvents.getById>) =>
    (await runtimeStores).events.getById(...args),
  create: async (...args: Parameters<typeof memoryEvents.create>) =>
    (await runtimeStores).events.create(...args),
  listAll: async (...args: Parameters<typeof memoryEvents.listAll>) =>
    (await runtimeStores).events.listAll(...args),
  update: async (...args: Parameters<typeof memoryEvents.update>) =>
    (await runtimeStores).events.update(...args),
};

export const seats = {
  getByEvent: async (...args: Parameters<typeof memorySeats.getByEvent>) =>
    (await runtimeStores).seats.getByEvent(...args),
  claimSeats: async (...args: Parameters<typeof memorySeats.claimSeats>) =>
    (await runtimeStores).seats.claimSeats(...args),
  releaseSeats: async (...args: Parameters<typeof memorySeats.releaseSeats>) =>
    (await runtimeStores).seats.releaseSeats(...args),
};

export const runtimeReady = (async () => {
  if (!cosmosEndpoint) {
    for (const event of demoEvents) {
      try {
        await memoryEvents.create(event);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "EVENT_ALREADY_EXISTS") {
          throw error;
        }
      }
    }
    memorySeats.seed(demoSeats);
    return;
  }

  const stores = await runtimeStores;

  for (const event of demoEvents) {
    const existing = await stores.events.getById(event.id);
    if (!existing) {
      await stores.events.create(event);
    }

    const existingSeats = await stores.seats.getByEvent(event.id);
    if (existingSeats.length === 0) {
      if (!("seedEventSeats" in stores.seats)) {
        throw new Error("COSMOS_SEAT_SEEDING_UNAVAILABLE");
      }

      await stores.seats.seedEventSeats(demoSeats.filter((seat) => seat.eventId === event.id));
    }
  }
})();

export const bookingDependencies: BookingDependencies = {
  bookings,
  seats,
  events,
  queue,
  eventBus,
  clock,
  assumedThroughputPerSecond: 10,
  maxSeatsPerBooking: 4,
  maxSeatsPerUserPerEvent: 4,
};

export { submitBooking, processBooking };
