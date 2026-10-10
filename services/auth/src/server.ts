import { createServiceApp } from "../../../shared/service-app.js";
import { connectKafka } from "../../../shared/kafka.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { router } from "./routes.js";

const kafka = await connectKafka(config.KAFKA_BROKERS, "auth-service");
await kafka.subscribe("auth-loyalty", ["order.confirmed"], async (event) => {
  const data = event.data as { userId: number; total: string };
  await prisma.$transaction(async (tx) => {
    if (await tx.processedEvent.findUnique({ where: { eventId: event.id } })) return;
    await tx.user.update({ where: { id: data.userId }, data: { score: { increment: Math.max(1, Math.floor(Number(data.total) / 10)) } } });
    await tx.processedEvent.create({ data: { eventId: event.id } });
  });
});
const server = createServiceApp("auth-service", router, async () => { await prisma.$queryRaw`SELECT 1`; }).listen(config.PORT, () => console.log(`auth-service:${config.PORT}`));
const stop = () => server.close(() => void Promise.all([prisma.$disconnect(), kafka.disconnect()]).finally(() => process.exit(0)));
process.on("SIGTERM", stop); process.on("SIGINT", stop);
