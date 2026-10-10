import express, { type Router } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { errorHandler, notFound } from "./http.js";
export function createServiceApp(name: string, router: Router, ready: () => Promise<void>) {
  const app = express();
  app.disable("x-powered-by"); app.use(helmet()); app.use(express.json({ limit: "100kb" })); app.use(morgan("dev"));
  app.get("/health/live", (_req, res) => res.json({ status: "ok", service: name }));
  app.get("/health/ready", async (_req, res) => {
    try { await ready(); res.json({ status: "ready", service: name }); }
    catch { res.status(503).json({ status: "not-ready", service: name }); }
  });
  app.use(router); app.use(notFound); app.use(errorHandler); return app;
}
