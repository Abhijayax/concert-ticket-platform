import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { bookingDependencies, bookings, processBooking, runtimeReady } from "../runtime.js";

function response(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: { "Cache-Control": "no-store" },
  };
}

function isLocalDevelopment(): boolean {
  return (
    process.env.ALLOW_DEMO_AUTH === "true" ||
    (process.env.NODE_ENV === "development" && !process.env.WEBSITE_SITE_NAME)
  );
}

export async function processBookingHandler(request: HttpRequest): Promise<HttpResponseInit> {
  if (!isLocalDevelopment()) {
    return response(403, {
      error: {
        code: "LOCAL_DEVELOPMENT_ONLY",
        message: "This endpoint is available only during local development.",
      },
    });
  }

  await runtimeReady;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return response(400, {
      error: {
        code: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      },
    });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("bookingId" in body) ||
    typeof body.bookingId !== "string" ||
    body.bookingId.length === 0
  ) {
    return response(400, {
      error: {
        code: "INVALID_BOOKING_ID",
        message: "Provide a non-empty bookingId.",
      },
    });
  }

  const booking = await bookings.getById(body.bookingId);

  if (!booking) {
    return response(404, {
      error: {
        code: "BOOKING_NOT_FOUND",
        message: "The requested booking does not exist.",
      },
    });
  }

  await processBooking(
    {
      bookingId: booking.id,
      userId: booking.userId,
      userEmail: booking.userEmail,
      eventId: booking.eventId,
      seatIds: booking.seatIds,
    },
    bookingDependencies,
  );

  const updated = await bookings.getById(booking.id);

  return response(200, { booking: updated });
}

app.http("processBooking", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "dev/process-booking",
  handler: processBookingHandler,
});
