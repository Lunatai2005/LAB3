import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createProxyMiddleware } from "http-proxy-middleware";
import { config } from "./config.js";
const app = express();
app.disable("x-powered-by"); app.use(helmet()); app.use(cors({ origin: config.CORS_ORIGIN.split(",").map((x) => x.trim()) })); app.use(morgan("dev"));
const route = (prefix: string, target: string) => app.use(prefix, createProxyMiddleware({ target, changeOrigin: true, pathRewrite: (path) => `${prefix}${path}` }));
route("/api/v1/auth", config.AUTH_URL); route("/api/v1/products", config.CATALOG_URL); route("/api/v1/orders", config.ORDER_URL); route("/api/v1/shipments", config.SHIPPING_URL);
app.get("/health/live", (_req, res) => res.json({ status: "ok", service: "api-gateway" }));
app.get("/health/ready", async (_req, res) => {
  const targets = { auth: config.AUTH_URL, catalog: config.CATALOG_URL, order: config.ORDER_URL, shipping: config.SHIPPING_URL };
  const checks = await Promise.all(Object.entries(targets).map(async ([name, url]) => {
    try { const response = await fetch(`${url}/health/ready`, { signal: AbortSignal.timeout(2000) }); return [name, response.ok] as const; } catch { return [name, false] as const; }
  }));
  const ready = checks.every(([, ok]) => ok); res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not-ready", services: Object.fromEntries(checks) });
});
app.get("/", (_req, res) => res.json({ name: "E-commerce Microservices API Gateway", version: "2.0.0" }));
app.use((_req, res) => res.status(404).json({ success: false, error: "Endpoint không tồn tại" }));
const server = app.listen(config.PORT, () => console.log(`api-gateway:${config.PORT}`));
const stop = () => server.close(() => process.exit(0)); process.on("SIGTERM", stop); process.on("SIGINT", stop);
