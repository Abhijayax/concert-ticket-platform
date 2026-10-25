import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { DomainError } from "@tix/core";
import { logActivity } from "../activityLog.js";
import { authenticate, jsonResponse } from "../auth.js";
import { bookingDependencies, bookings, runtimeReady, submitBooking } from "../runtime.js";

function domainErrorResponse(error: unknown): HttpResponseInit {
  if (error instanceof DomainError) {
    return jsonResponse(error.statusCode, {
      error: {
        code: error.code,
        message: error.message,
      },
    });
  }

  // Log the cause server-side (name and message only); the client gets a generic error.
  console.error(
    "Unhandled booking error:",
    error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  );

  return jsonResponse(500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    },
  });
}

export async function submitBookingHandler(request: HttpRequest): Promise<HttpResponseInit> {
  const auth = authenticate(request, "user");

  if ("response" in auth) {
    return auth.response;
  }

  const localUser = auth.user;

  await runtimeReady;

  const idempotencyKey = request.headers.get("Idempotency-Key");

  if (!idempotencyKey) {
    return jsonResponse(400, {
      error: {
        code: "INVALID_REQUEST",
        message: "The Idempotency-Key header is required.",
      },
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, {
      error: {
        code: "INVALID_REQUEST",
        message: "A valid JSON request body is required.",
      },
    });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("eventId" in body) ||
    !("seatIds" in body) ||
    typeof body.eventId !== "string" ||
    !Array.isArray(body.seatIds) ||
    !body.seatIds.every((seatId) => typeof seatId === "string")
  ) {
    return jsonResponse(400, {
      error: {
        code: "INVALID_REQUEST",
        message: "Provide an eventId and an array of seatIds.",
      },
    });
  }

  try {
    const result = await submitBooking(
      {
        eventId: body.eventId,
        seatIds: body.seatIds,
        idempotencyKey,
        userId: localUser.id,
        userEmail: localUser.email,
      },
      bookingDependencies,
    );

    logActivity(
      "BOOKING_SUBMITTED",
      localUser.username,
      `${result.booking.id} ${result.booking.eventId} seats=${body.seatIds.length} http=${result.httpStatus}`,
    );

    return jsonResponse(result.httpStatus, {
      booking: result.booking,
    });
  } catch (error) {
    if (error instanceof DomainError && error.statusCode === 503) {
      return {
        ...domainErrorResponse(error),
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "2",
        },
      };
    }

    if (error instanceof DomainError) {
      logActivity("BOOKING_REJECTED", localUser.username, error.code);
    }

    return domainErrorResponse(error);
  }
}

export async function getBookingHandler(request: HttpRequest): Promise<HttpResponseInit> {
  const auth = authenticate(request, "user");

  if ("response" in auth) {
    return auth.response;
  }

  const localUser = auth.user;

  await runtimeReady;

  const bookingId = request.params.bookingId ?? "";
  const booking = await bookings.getById(bookingId);

  if (!booking || booking.userId !== localUser.id) {
    return jsonResponse(404, {
      error: {
        code: "BOOKING_NOT_FOUND",
        message: "Booking not found.",
      },
    });
  }

  return jsonResponse(200, { booking });
}

export async function listMyBookingsHandler(request: HttpRequest): Promise<HttpResponseInit> {
  const auth = authenticate(request, "user");

  if ("response" in auth) {
    return auth.response;
  }

  const localUser = auth.user;

  await runtimeReady;

  const userBookings = await bookings.listByUser(localUser.id);

  return jsonResponse(200, {
    count: userBookings.length,
    bookings: userBookings,
  });
}

app.http("submitBooking", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "bookings",
  handler: submitBookingHandler,
});

app.http("getBooking", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "bookings/{bookingId}",
  handler: getBookingHandler,
});

app.http("listMyBookings", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "me/bookings",
  handler: listMyBookingsHandler,
});
