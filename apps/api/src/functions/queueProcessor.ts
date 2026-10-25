import { app, type InvocationContext } from "@azure/functions";
import type { QueueMessage } from "@tix/core";
import { logActivity } from "../activityLog.js";
import { bookingDependencies, processBooking, runtimeReady } from "../runtime.js";

function isQueueMessage(value: unknown): value is QueueMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.bookingId === "string" &&
    typeof m.userId === "string" &&
    typeof m.userEmail === "string" &&
    typeof m.eventId === "string" &&
    Array.isArray(m.seatIds) &&
    m.seatIds.every((s) => typeof s === "string")
  );
}

/**
 * Queue-triggered booking processor.
 *
 * Retry safety: processBooking is idempotent (seat claims are conditional and a
 * confirmed booking is not re-confirmed). Domain failures (e.g. SEAT_UNAVAILABLE) mark the
 * booking FAILED and complete the message. Unexpected infrastructure errors are rethrown,
 * so Service Bus redelivers up to maxDeliveryCount (5) and then dead-letters the message.
 */
export async function processBookingMessage(
  message: unknown,
  context: InvocationContext,
): Promise<void> {
  if (!isQueueMessage(message)) {
    // Poison message: rethrow so it is retried and then dead-lettered for inspection.
    throw new Error("Invalid booking message shape.");
  }

  await runtimeReady;
  context.log(`Processing booking ${message.bookingId}`);
  await processBooking(message, bookingDependencies);
  logActivity("BOOKING_PROCESSED", "queue", message.bookingId);
}

// Registered only when Service Bus is configured (identity-based connection).
if (process.env.ServiceBusConnection__fullyQualifiedNamespace) {
  app.serviceBusQueue("processBookingQueue", {
    connection: "ServiceBusConnection",
    queueName: process.env.SERVICEBUS_QUEUE?.trim() || "booking-requests",
    handler: processBookingMessage,
  });
}
