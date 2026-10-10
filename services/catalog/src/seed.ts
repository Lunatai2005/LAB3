import { prisma } from "./db.js";
for (const product of [{ name: "Laptop MVP", price: "1599.00", quantity: 10 }, { name: "Wireless Mouse", price: "29.90", quantity: 50 }]) {
  if (!await prisma.product.findFirst({ where: { name: product.name } })) await prisma.product.create({ data: product });
}
await prisma.$disconnect();
