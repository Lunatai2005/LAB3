import { createServiceApp } from "../../../shared/service-app.js";
import { connectKafka } from "../../../shared/kafka.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { router } from "./routes.js";

const kafka = await connectKafka(config.KAFKA_BROKERS, "catalog-service");
await kafka.subscribe("catalog-inventory", ["order.created", "order.cancelled"], async (event) => {
  if (await prisma.processedEvent.findUnique({ where: { eventId: event.id } })) return;
  if (event.type === "order.created") {
    const data = event.data as { orderId: number; items: Array<{ productId: number; quantity: number }> };
    try {
      await prisma.$transaction(async (tx) => {
        for (const item of data.items) {
          const changed = await tx.product.updateMany({ where: { id: item.productId, quantity: { gte: item.quantity } }, data: { quantity: { decrement: item.quantity } } });
          if (!changed.count) throw new Error(`Sản phẩm ${item.productId} không đủ tồn kho`);
          await tx.reservation.create({ data: { orderId: data.orderId, productId: item.productId, quantity: item.quantity } });
        }
        await tx.processedEvent.create({ data: { eventId: event.id } });
      });
      await kafka.publish("inventory.reserved", { orderId: data.orderId });
    } catch (error) {
      await prisma.processedEvent.create({ data: { eventId: event.id } });
      await kafka.publish("inventory.rejected", { orderId: data.orderId, reason: error instanceof Error ? error.message : "Không thể giữ tồn kho" });
    }
  } else {
    const { orderId } = event.data as { orderId: number };
    await prisma.$transaction(async (tx) => {
      const reservations = await tx.reservation.findMany({ where: { orderId, status: "RESERVED" } });
      for (const row of reservations) await tx.product.update({ where: { id: row.productId }, data: { quantity: { increment: row.quantity } } });
      await tx.reservation.updateMany({ where: { orderId, status: "RESERVED" }, data: { status: "RELEASED" } });
      await tx.processedEvent.create({ data: { eventId: event.id } });
    });
  }
});
const server = createServiceApp("catalog-service", router, async () => { await prisma.$queryRaw`SELECT 1`; }).listen(config.PORT, () => console.log(`catalog-service:${config.PORT}`));
const stop = () => server.close(() => void Promise.all([prisma.$disconnect(), kafka.disconnect()]).finally(() => process.exit(0)));
process.on("SIGTERM", stop); process.on("SIGINT", stop);
