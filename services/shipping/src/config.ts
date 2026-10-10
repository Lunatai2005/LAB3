import "dotenv/config";
import { z } from "zod";
export const config = z.object({ PORT: z.coerce.number().default(3004), SHIPPING_DATABASE_URL: z.string().min(1), JWT_SECRET: z.string().min(32), KAFKA_BROKERS: z.string().min(1) }).parse(process.env);
