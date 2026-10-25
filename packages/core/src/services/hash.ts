import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function makeBookingId(userId: string, idempotencyKey: string): string {
  return `bk_${sha256(`${userId}:${idempotencyKey}`).slice(0, 32)}`;
}

export function makeRequestHash(eventId: string, seatIds: string[]): string {
  const canonical = JSON.stringify({
    eventId,
    seatIds: [...seatIds].sort(),
  });

  return sha256(canonical);
}
