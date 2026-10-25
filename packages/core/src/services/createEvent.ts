import type { ConcertEvent, Seat } from "../domain/types.js";
import type { EventStore, SeatStore } from "../ports/index.js";

export interface EventLayoutSection {
  name: string;
  rows: number;
  seatsPerRow: number;
  price: number;
}

export async function createEvent(
  event: Omit<ConcertEvent, "totalSeats" | "soldOutNotified">,
  layout: EventLayoutSection[],
  events: EventStore,
  seats: SeatStore,
): Promise<ConcertEvent> {
  let totalSeats = 0;

  for (const section of layout) {
    if (
      !section.name.trim() ||
      !Number.isInteger(section.rows) ||
      !Number.isInteger(section.seatsPerRow) ||
      section.rows < 1 ||
      section.seatsPerRow < 1 ||
      !Number.isFinite(section.price) ||
      section.price < 0
    ) {
      throw new Error("INVALID_REQUEST");
    }

    totalSeats += section.rows * section.seatsPerRow;
  }

  if (totalSeats < 1 || totalSeats > 5000) {
    throw new Error("INVALID_REQUEST");
  }

  const created: ConcertEvent = {
    ...event,
    totalSeats,
    soldOutNotified: false,
  };

  const generated: Seat[] = [];

  for (const section of layout) {
    for (let row = 1; row <= section.rows; row += 1) {
      for (let number = 1; number <= section.seatsPerRow; number += 1) {
        generated.push({
          id: `${section.name}-${row}-${number}`,
          eventId: event.id,
          section: section.name,
          row,
          number,
          price: section.price,
          status: "AVAILABLE",
        });
      }
    }
  }

  // This local adapter seeds the generated seats directly. The production
  // Cosmos adapter must implement event creation with safe batch semantics.
  await events.create(created);

  const memorySeats = seats as SeatStore & {
    seed?: (items: Seat[]) => void;
  };

  if (!memorySeats.seed) {
    throw new Error(
      "This createEvent implementation requires a seat seeding adapter. Implement the production adapter separately.",
    );
  }

  memorySeats.seed(generated);

  return created;
}
