import { Kafka, logLevel, Partitioners, type Consumer, type Producer } from "kafkajs";

export type EventEnvelope<T = unknown> = { id: string; type: string; occurredAt: string; data: T };

export const EVENT_TOPICS = [
  "order.created",
  "inventory.reserved",
  "inventory.rejected",
  "order.confirmed",
  "order.cancelled",
  "shipment.created",
  "shipment.cancelled"
] as const;

export class KafkaBus {
  private readonly consumers: Consumer[] = [];

  constructor(private readonly kafka: Kafka, private readonly producer: Producer) {}

  async publish<T>(type: string, data: T) {
    const event: EventEnvelope<T> = { id: crypto.randomUUID(), type, occurredAt: new Date().toISOString(), data };
    const keySource = data as { orderId?: number; userId?: number };
    await this.producer.send({ topic: type, acks: -1, messages: [{ key: String(keySource.orderId ?? keySource.userId ?? event.id), value: JSON.stringify(event), headers: { eventId: event.id } }] });
    return event;
  }

  async subscribe(groupId: string, topics: string[], handler: (event: EventEnvelope) => Promise<void>) {
    const consumer = this.kafka.consumer({ groupId, retry: { retries: 10 } });
    await consumer.connect();
    await consumer.subscribe({ topics, fromBeginning: false });
    await consumer.run({ eachMessage: async ({ message }) => {
      if (!message.value) return;
      await handler(JSON.parse(message.value.toString()) as EventEnvelope);
    } });
    this.consumers.push(consumer);
  }

  async disconnect() {
    await Promise.all(this.consumers.map((consumer) => consumer.disconnect()));
    await this.producer.disconnect();
  }
}

export async function connectKafka(brokersValue: string, clientId: string) {
  const kafka = new Kafka({ clientId, brokers: brokersValue.split(",").map((x) => x.trim()), logLevel: logLevel.WARN, retry: { retries: 20, initialRetryTime: 500 } });
  const producer = kafka.producer({ allowAutoTopicCreation: false, idempotent: true, maxInFlightRequests: 1, createPartitioner: Partitioners.DefaultPartitioner, retry: { retries: Number.MAX_SAFE_INTEGER } });
  await producer.connect();
  return new KafkaBus(kafka, producer);
}
