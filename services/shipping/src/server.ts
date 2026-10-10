import { createServiceApp } from "../../../shared/service-app.js";
import { connectKafka } from "../../../shared/kafka.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { router } from "./routes.js";
const kafka = await connectKafka(config.KAFKA_BROKERS, "shipping-service");
await kafka.subscribe("shipping-saga", ["order.confirmed", "order.cancelled"], async (event) => {
  if (await prisma.processedEvent.findUnique({ where: { eventId: event.id } })) return;
  const { orderId } = event.data as { orderId: number };
  await prisma.$transaction(async (tx) => {
    if (event.type === "order.confirmed") await tx.shipment.upsert({ where: { orderId }, update: {}, create: { orderId } });
    else await tx.shipment.updateMany({ where: { orderId, status: { not: "DELIVERED" } }, data: { status: "CANCELLED" } });
    await tx.processedEvent.create({ data: { eventId: event.id } });
  });
  await kafka.publish(event.type === "order.confirmed" ? "shipment.created" : "shipment.cancelled", { orderId });
});
const server = createServiceApp("shipping-service", router, async () => { await prisma.$queryRaw`SELECT 1`; }).listen(config.PORT, () => console.log(`shipping-service:${config.PORT}`));
const stop = () => server.close(() => void Promise.all([prisma.$disconnect(), kafka.disconnect()]).finally(() => process.exit(0)));
process.on("SIGTERM", stop); process.on("SIGINT", stop);
