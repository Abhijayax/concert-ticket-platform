import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { events, runtimeReady, seats } from "../runtime.js";

function jsonResponse(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: {
      "Cache-Control": "no-store",
    },
  };
}

export async function listEventsHandler(): Promise<HttpResponseInit> {
  await runtimeReady;
  const allEvents = await events.listAll();

  return jsonResponse(200, {
    count: allEvents.length,
    events: allEvents,
  });
}

export async function getEventHandler(request: HttpRequest): Promise<HttpResponseInit> {
  await runtimeReady;

  const event = await events.getById(request.params.eventId ?? "");

  if (!event) {
    return jsonResponse(404, {
      error: {
        code: "EVENT_NOT_FOUND",
        message: "The requested event does not exist.",
      },
    });
  }

  return jsonResponse(200, event);
}

export async function getEventSeatsHandler(request: HttpRequest): Promise<HttpResponseInit> {
  await runtimeReady;

  const eventId = request.params.eventId ?? "";
  const event = await events.getById(eventId);

  if (!event) {
    return jsonResponse(404, {
      error: {
        code: "EVENT_NOT_FOUND",
        message: "The requested event does not exist.",
      },
    });
  }

  const eventSeats = await seats.getByEvent(eventId);

  return jsonResponse(200, {
    eventId,
    count: eventSeats.length,
    availableCount: eventSeats.filter((seat) => seat.status === "AVAILABLE").length,
    seats: eventSeats,
  });
}

app.http("listEvents", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "events",
  handler: listEventsHandler,
});

app.http("getEvent", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "events/{eventId}",
  handler: getEventHandler,
});

app.http("getEventSeats", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "events/{eventId}/seats",
  handler: getEventSeatsHandler,
});
