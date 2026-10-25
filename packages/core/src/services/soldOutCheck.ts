import type { BookingDependencies } from "../ports/index.js";

export async function soldOutCheck(deps: BookingDependencies): Promise<string[]> {
  const now = deps.clock.now();
  const events = await deps.events.listAll();
  const newlySoldOut: string[] = [];

  for (const event of events) {
    if (event.soldOutAt || now.getTime() < new Date(event.saleStartsAt).getTime()) {
      continue;
    }

    const seats = await deps.seats.getByEvent(event.id);

    if (seats.length === 0 || seats.some((seat) => seat.status === "AVAILABLE")) {
      continue;
    }

    const updated = {
      ...event,
      soldOutAt: now.toISOString(),
      soldOutNotified: true,
    };

    await deps.events.update(updated);

    await deps.eventBus.publish({
      type: "EventSoldOut",
      eventId: event.id,
    });

    newlySoldOut.push(event.id);
  }

  return newlySoldOut;
}
