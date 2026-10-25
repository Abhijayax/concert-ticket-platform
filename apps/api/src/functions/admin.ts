import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { listActivity } from "../activityLog.js";
import { authenticate, jsonResponse } from "../auth.js";
import { bookings, events, queue, runtimeReady, seats, usingServiceBus } from "../runtime.js";

const startedAt = new Date().toISOString();

export async function adminOverviewHandler(request: HttpRequest): Promise<HttpResponseInit> {
  const auth = authenticate(request, "admin");

  if ("response" in auth) {
    return auth.response;
  }

  await runtimeReady;

  const [allEvents, allBookings] = await Promise.all([events.listAll(), bookings.listAll()]);

  const perEvent = await Promise.all(
    allEvents.map(async (event) => {
      const eventSeats = await seats.getByEvent(event.id);
      return {
        id: event.id,
        title: event.title,
        totalSeats: eventSeats.length,
        booked: eventSeats.filter((seat) => seat.status === "BOOKED").length,
        available: eventSeats.filter((seat) => seat.status === "AVAILABLE").length,
      };
    }),
  );

  let queueDepth: number | null = null;

  try {
    queueDepth = await queue.depth();
  } catch {
    queueDepth = null;
  }

  const byStatus = { QUEUED: 0, CONFIRMED: 0, FAILED: 0 };

  for (const booking of allBookings) {
    byStatus[booking.status] += 1;
  }

  return jsonResponse(200, {
    system: {
      startedAt,
      queueBackend: usingServiceBus ? "Azure Service Bus (Basic)" : "In-memory",
      dataStore: process.env.COSMOS_ENDPOINT ? "Azure Cosmos DB" : "In-memory",
      queueDepth,
    },
    bookings: { total: allBookings.length, ...byStatus },
    events: perEvent,
  });
}

export async function adminBookingsHandler(request: HttpRequest): Promise<HttpResponseInit> {
  const auth = authenticate(request, "admin");

  if ("response" in auth) {
    return auth.response;
  }

  await runtimeReady;

  const all = await bookings.listAll();
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return jsonResponse(200, { count: all.length, bookings: all });
}

export async function adminActivityHandler(request: HttpRequest): Promise<HttpResponseInit> {
  const auth = authenticate(request, "admin");

  if ("response" in auth) {
    return auth.response;
  }

  const entries = listActivity();

  return jsonResponse(200, {
    note: "In-memory log of recent activity for this API process; cleared on restart.",
    count: entries.length,
    entries,
  });
}

app.http("adminOverview", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "console/overview",
  handler: adminOverviewHandler,
});

app.http("adminBookings", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "console/bookings",
  handler: adminBookingsHandler,
});

app.http("adminActivity", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "console/activity",
  handler: adminActivityHandler,
});
