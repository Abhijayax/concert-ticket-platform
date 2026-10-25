import type { EventBus, Queue, QueueMessage } from "../../ports/index.js";

export class MemoryQueue implements Queue {
  private readonly messages: QueueMessage[] = [];

  async send(message: QueueMessage): Promise<void> {
    if (this.messages.some((item) => item.bookingId === message.bookingId)) {
      return;
    }

    this.messages.push(structuredClone(message));
  }

  async depth(): Promise<number> {
    return this.messages.length;
  }

  async receive(): Promise<QueueMessage | undefined> {
    const message = this.messages.shift();
    return message ? structuredClone(message) : undefined;
  }
}

export class MemoryEventBus implements EventBus {
  readonly published: Array<{
    type: "BookingConfirmed" | "BookingFailed" | "EventSoldOut";
    bookingId?: string;
    eventId: string;
    userId?: string;
    reason?: string;
  }> = [];

  async publish(event: {
    type: "BookingConfirmed" | "BookingFailed" | "EventSoldOut";
    bookingId?: string;
    eventId: string;
    userId?: string;
    reason?: string;
  }): Promise<void> {
    this.published.push(structuredClone(event));
  }
}
