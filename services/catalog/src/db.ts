import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.js";
import { config } from "./config.js";
export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.CATALOG_DATABASE_URL }) });
