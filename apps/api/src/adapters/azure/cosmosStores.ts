import {
  BulkOperationType,
  CosmosClient,
  type Container,
  type Database,
  type OperationInput,
  type SqlQuerySpec,
} from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

import type { Booking, ConcertEvent, Seat } from "@tix/core";

import type { BookingStore, EventStore, SeatStore } from "@tix/core";

interface CosmosDocument {
  id: string;
  [key: string]: unknown;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number | string }).code === 404
  );
}

function isConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number | string }).code === 409
  );
}

function asDocument<T extends { id: string }>(value: T): CosmosDocument {
  return structuredClone(value) as unknown as CosmosDocument;
}
function withoutCosmosMetadata<T extends object>(value: T): T {
  const document = { ...value } as Record<string, unknown>;

  for (const key of ["_rid", "_self", "_etag", "_attachments", "_ts"]) {
    delete document[key];
  }

  return document as T;
}
function isSuccessfulStatus(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

function hasBatchFailure(response: {
  code?: number;
  result?: Array<{ statusCode: number }>;
}): boolean {
  return (
    response.code === undefined ||
    !isSuccessfulStatus(response.code) ||
    (response.result?.some((operation) => !isSuccessfulStatus(operation.statusCode)) ?? false)
  );
}

export class CosmosEventStore implements EventStore {
  constructor(private readonly container: Container) {}

  async getById(eventId: string): Promise<ConcertEvent | undefined> {
    try {
      const result = await this.container.item(eventId, eventId).read<ConcertEvent>();

      return result.resource ? withoutCosmosMetadata(result.resource) : undefined;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async create(event: ConcertEvent): Promise<void> {
    try {
      await this.container.items.create(asDocument(event));
    } catch (error) {
      if (isConflict(error)) {
        throw new Error("EVENT_ALREADY_EXISTS");
      }
      throw error;
    }
  }

  async listAll(): Promise<ConcertEvent[]> {
    const query: SqlQuerySpec = {
      query: "SELECT * FROM c",
    };

    const result = await this.container.items.query<ConcertEvent>(query).fetchAll();

    return result.resources.map(withoutCosmosMetadata);
  }

  async update(event: ConcertEvent): Promise<void> {
    try {
      await this.container.item(event.id, event.id).replace(asDocument(event));
    } catch (error) {
      if (isNotFound(error)) {
        throw new Error("EVENT_NOT_FOUND");
      }
      throw error;
    }
  }
}

export class CosmosBookingStore implements BookingStore {
  constructor(private readonly container: Container) {}

  async getById(bookingId: string): Promise<Booking | undefined> {
    // Bookings are partitioned by userId, so a direct point read requires
    // the partition key. This query locates a booking across partitions.
    const query: SqlQuerySpec = {
      query: "SELECT * FROM c WHERE c.id = @id",
      parameters: [{ name: "@id", value: bookingId }],
    };

    const result = await this.container.items.query<Booking>(query, { maxItemCount: 2 }).fetchAll();

    if (result.resources.length > 1) {
      throw new Error("BOOKING_ID_NOT_UNIQUE");
    }

    const booking = result.resources[0];
    return booking ? withoutCosmosMetadata(booking) : undefined;
  }

  async create(booking: Booking): Promise<"CREATED" | "EXISTS"> {
    try {
      await this.container.items.create(asDocument(booking));
      return "CREATED";
    } catch (error) {
      if (isConflict(error)) return "EXISTS";
      throw error;
    }
  }

  async update(booking: Booking): Promise<void> {
    try {
      await this.container.item(booking.id, booking.userId).replace(asDocument(booking));
    } catch (error) {
      if (isNotFound(error)) {
        throw new Error("BOOKING_NOT_FOUND");
      }
      throw error;
    }
  }

  async listByUser(userId: string): Promise<Booking[]> {
    const result = await this.container.items
      .query<Booking>(
        {
          query: "SELECT * FROM c WHERE c.userId = @userId",
          parameters: [{ name: "@userId", value: userId }],
        },
        { partitionKey: userId },
      )
      .fetchAll();

    return result.resources.map(withoutCosmosMetadata);
  }

  async listAll(): Promise<Booking[]> {
    const result = await this.container.items
      .query<Booking>({ query: "SELECT * FROM c" })
      .fetchAll();

    return result.resources.map(withoutCosmosMetadata);
  }
}

export class CosmosSeatStore implements SeatStore {
  constructor(private readonly container: Container) {}

  /**
   * Seed only an empty event partition. Existing seats are never overwritten.
   */
  async seedEventSeats(seats: Seat[]): Promise<void> {
    if (seats.length === 0) return;

    const eventIds = new Set(seats.map((seat) => seat.eventId));
    if (eventIds.size !== 1) {
      throw new Error("SEAT_SEED_MUST_USE_ONE_EVENT_PARTITION");
    }

    const eventId = seats[0]!.eventId;
    const existing = await this.getByEvent(eventId);

    if (existing.length > 0) return;

    // Create each item independently. A concurrent initializer may win;
    // conflicts are harmless only if the seat now exists.
    for (const seat of seats) {
      try {
        await this.container.items.create(asDocument(seat));
      } catch (error) {
        if (!isConflict(error)) throw error;

        const reread = await this.getByEvent(eventId);
        if (!reread.some((current) => current.id === seat.id)) {
          throw error;
        }
      }
    }
  }

  async getByEvent(eventId: string): Promise<Seat[]> {
    const result = await this.container.items
      .query<Seat>(
        {
          query: "SELECT * FROM c WHERE c.eventId = @eventId",
          parameters: [{ name: "@eventId", value: eventId }],
        },
        { partitionKey: eventId },
      )
      .fetchAll();

    return result.resources.map(withoutCosmosMetadata);
  }

  async claimSeats(
    eventId: string,
    seatIds: string[],
    bookingId: string,
    userId: string,
    bookedAt: string,
  ): Promise<void> {
    if (seatIds.length === 0) return;

    const uniqueIds = [...new Set(seatIds)];

    if (uniqueIds.length !== seatIds.length) {
      throw new Error("SEAT_UNAVAILABLE");
    }

    // Read the requested seats before constructing the atomic batch.
    const currentSeats = await Promise.all(
      uniqueIds.map(async (seatId): Promise<Seat> => {
        try {
          const result = await this.container.item(seatId, eventId).read<Seat>();

          if (!result.resource) {
            throw new Error("SEAT_NOT_FOUND");
          }

          return result.resource;
        } catch (error) {
          if (isNotFound(error)) {
            throw new Error("SEAT_NOT_FOUND");
          }
          throw error;
        }
      }),
    );

    // An already-completed claim by this booking is a safe retry.
    if (currentSeats.every((seat) => seat.status === "BOOKED" && seat.bookingId === bookingId)) {
      return;
    }

    if (currentSeats.some((seat) => seat.status !== "AVAILABLE")) {
      throw new Error("SEAT_UNAVAILABLE");
    }

    // Cosmos transactional batches are atomic within a single partition.
    // The condition is evaluated by Cosmos itself, not by this process.
    // If any seat is no longer AVAILABLE, the entire batch fails.
    const operations: OperationInput[] = currentSeats.map((seat) => ({
      operationType: BulkOperationType.Patch,
      id: seat.id,
      partitionKey: eventId,
      resourceBody: {
        condition: "FROM c WHERE c.status = 'AVAILABLE'",
        operations: [
          { op: "replace", path: "/status", value: "BOOKED" },
          { op: "add", path: "/bookingId", value: bookingId },
          { op: "add", path: "/bookedBy", value: userId },
          { op: "add", path: "/bookedAt", value: bookedAt },
        ],
      },
    }));

    let batchFailed = false;

    try {
      const response = await this.container.items.batch(operations, eventId);

      batchFailed = hasBatchFailure(response);
    } catch (error) {
      // A failed request may have an ambiguous outcome if the connection
      // breaks after Cosmos commits. Reread before deciding whether retrying
      // the same booking is safe.
      const reread = await this.getByEvent(eventId);
      const byId = new Map(reread.map((seat) => [seat.id, seat]));

      if (
        uniqueIds.every((id) => {
          const seat = byId.get(id);
          return seat?.status === "BOOKED" && seat.bookingId === bookingId;
        })
      ) {
        return;
      }

      if (isConflict(error)) {
        throw new Error("SEAT_UNAVAILABLE");
      }

      throw error;
    }

    if (batchFailed) {
      // The batch is atomic: no subset of the requested seat claims should
      // have committed. Reread to recognize a successful same-booking retry.
      const reread = await this.getByEvent(eventId);
      const byId = new Map(reread.map((seat) => [seat.id, seat]));

      if (
        uniqueIds.every((id) => {
          const seat = byId.get(id);
          return seat?.status === "BOOKED" && seat.bookingId === bookingId;
        })
      ) {
        return;
      }

      throw new Error("SEAT_UNAVAILABLE");
    }
  }

  async releaseSeats(bookingId: string): Promise<void> {
    // The seats container is partitioned by eventId. Each event therefore
    // needs its own transactional batch.
    const result = await this.container.items
      .query<Seat>({
        query: "SELECT * FROM c WHERE c.bookingId = @bookingId",
        parameters: [{ name: "@bookingId", value: bookingId }],
      })
      .fetchAll();

    const groups = new Map<string, Seat[]>();

    for (const seat of result.resources) {
      const group = groups.get(seat.eventId) ?? [];
      group.push(seat);
      groups.set(seat.eventId, group);
    }

    for (const [eventId, seats] of groups) {
      const operations: OperationInput[] = seats.map((seat) => ({
        operationType: BulkOperationType.Patch,
        id: seat.id,
        partitionKey: eventId,
        resourceBody: {
          condition: `FROM c WHERE c.bookingId = ${JSON.stringify(bookingId)}`,
          operations: [
            { op: "replace", path: "/status", value: "AVAILABLE" },
            { op: "remove", path: "/bookingId" },
            { op: "remove", path: "/bookedBy" },
            { op: "remove", path: "/bookedAt" },
          ],
        },
      }));

      const response = await this.container.items.batch(operations, eventId);

      if (hasBatchFailure(response)) {
        // If another retry already released these seats, that is safe.
        const reread = await this.getByEvent(eventId);
        const byId = new Map(reread.map((seat) => [seat.id, seat]));

        const allReleased = seats.every((seat) => {
          const current = byId.get(seat.id);
          return current?.status === "AVAILABLE" && current.bookingId === undefined;
        });

        if (!allReleased) {
          throw new Error("SEAT_RELEASE_FAILED");
        }
      }
    }
  }
}

export interface CosmosStores {
  database: Database;
  events: CosmosEventStore;
  bookings: CosmosBookingStore;
  seats: CosmosSeatStore;
}

export async function createCosmosStores(
  endpoint: string,
  databaseName = "ticketing",
): Promise<CosmosStores> {
  if (!endpoint) {
    throw new Error("COSMOS_ENDPOINT_REQUIRED");
  }

  // Uses Azure CLI credentials locally and managed identity when deployed.
  // The identity must have the required Cosmos DB data-plane permissions.
  const client = new CosmosClient({
    endpoint,
    aadCredentials: new DefaultAzureCredential(),
  });

  // Terraform owns database/container creation. The runtime only connects
  // to existing resources and therefore needs data-plane access, not DDL.
  const database = client.database(databaseName);

  return {
    database,
    events: new CosmosEventStore(database.container("events")),
    seats: new CosmosSeatStore(database.container("seats")),
    bookings: new CosmosBookingStore(database.container("bookings")),
  };
}
