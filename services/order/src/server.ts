import { createServiceApp } from "../../../shared/service-app.js";
import { connectKafka } from "../../../shared/kafka.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { createRouter } from "./routes.js";
const kafka = await connectKafka(config.KAFKA_BROKERS, "order-service");
await kafka.subscribe("order-saga", ["inventory.reserved", "inventory.rejected"], async (event) => {
  if (await prisma.processedEvent.findUnique({ where: { eventId: event.id } })) return;
  const data = event.data as { orderId: number; reason?: string };
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({ where: { id: data.orderId } });
    if (!existing || existing.status !== "PENDING") {
      await tx.processedEvent.create({ data: { eventId: event.id } });
      return { order: null, compensate: event.type === "inventory.reserved" && existing?.status === "CANCELLED" };
    }
    const updated = await tx.order.update({ where: { id: data.orderId }, data: event.type === "inventory.reserved" ? { status: "CONFIRMED" } : { status: "CANCELLED", failureReason: data.reason ?? "Hết hàng" } });
    await tx.processedEvent.create({ data: { eventId: event.id } }); return { order: updated, compensate: false };
  });
  if (result.compensate) { await kafka.publish("order.cancelled", { orderId: data.orderId, reason: "Đơn đã hủy trước khi giữ kho xong" }); return; }
  const order = result.order;
  if (!order) return;
  if (order.status === "CONFIRMED") await kafka.publish("order.confirmed", { orderId: order.id, userId: order.userId, total: order.total.toString() });
  else await kafka.publish("order.cancelled", { orderId: order.id, reason: order.failureReason });
});
const server = createServiceApp("order-service", createRouter(kafka), async () => { await prisma.$queryRaw`SELECT 1`; }).listen(config.PORT, () => console.log(`order-service:${config.PORT}`));
const stop = () => server.close(() => void Promise.all([prisma.$disconnect(), kafka.disconnect()]).finally(() => process.exit(0)));
process.on("SIGTERM", stop); process.on("SIGINT", stop);
