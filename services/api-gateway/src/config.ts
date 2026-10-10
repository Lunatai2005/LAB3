import "dotenv/config";
import { z } from "zod";
export const config = z.object({ PORT: z.coerce.number().default(3000), CORS_ORIGIN: z.string().default("http://localhost:3000"), AUTH_URL: z.string().url(), CATALOG_URL: z.string().url(), ORDER_URL: z.string().url(), SHIPPING_URL: z.string().url() }).parse(process.env);
