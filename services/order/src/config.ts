import "dotenv/config";
import { z } from "zod";
export const config = z.object({ PORT: z.coerce.number().default(3003), ORDER_DATABASE_URL: z.string().min(1), JWT_SECRET: z.string().min(32), INTERNAL_API_KEY: z.string().min(16), KAFKA_BROKERS: z.string().min(1), AUTH_URL: z.string().url(), CATALOG_URL: z.string().url() }).parse(process.env);
