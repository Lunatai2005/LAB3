import bcrypt from "bcryptjs";
import { prisma } from "./db.js";
await prisma.user.upsert({ where: { username: "admin" }, update: {}, create: { username: "admin", fullName: "System Administrator", passwordHash: await bcrypt.hash("Admin@123", 12), role: "ADMIN" } });
await prisma.$disconnect();
