import { DefaultAzureCredential } from "@azure/identity";
import {
  ServiceBusAdministrationClient,
  ServiceBusClient,
  type ServiceBusSender,
} from "@azure/service-bus";
import type { EventBus, Queue, QueueMessage } from "@tix/core";

type BusEvent = Parameters<EventBus["publish"]>[0];

export interface ServiceBusNames {
  /** Fully qualified namespace, e.g. my-ns.servicebus.windows.net (no secrets). */
  namespace: string;
  queueName: string;
  /** Optional. Requires Standard tier or higher; omit to skip event publishing. */
  topicName?: string | undefined;
}

/**
 * Service Bus adapters authenticating with Microsoft Entra ID (DefaultAzureCredential).
 * No connection strings or keys are used.
 */
export function createServiceBusAdapters(names: ServiceBusNames): {
  queue: Queue;
  eventBus: EventBus | undefined;
} {
  const credential = new DefaultAzureCredential();
  const client = new ServiceBusClient(names.namespace, credential);
  const admin = new ServiceBusAdministrationClient(names.namespace, credential);

  let queueSender: ServiceBusSender | undefined;
  let topicSender: ServiceBusSender | undefined;

  const queue: Queue = {
    async send(message: QueueMessage): Promise<void> {
      queueSender ??= client.createSender(names.queueName);
      await queueSender.sendMessages({
        // The booking ID is deterministic, so it doubles as a de-duplication key.
        messageId: message.bookingId,
        contentType: "application/json",
        body: message,
      });
    },
    async depth(): Promise<number> {
      const props = await admin.getQueueRuntimeProperties(names.queueName);
      return props.activeMessageCount;
    },
  };

  const topicName = names.topicName;
  const eventBus: EventBus | undefined = topicName
    ? {
        async publish(event: BusEvent): Promise<void> {
          topicSender ??= client.createSender(topicName);
          await topicSender.sendMessages({
            subject: event.type,
            contentType: "application/json",
            body: event,
            applicationProperties: { type: event.type, eventId: event.eventId },
          });
        },
      }
    : undefined;

  return { queue, eventBus };
}
