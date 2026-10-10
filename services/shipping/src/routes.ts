import { Router } from "express";
import { z } from "zod";
import { authenticate, authorize } from "../../../shared/auth.js";
import { asyncHandler } from "../../../shared/http.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { ShipmentStatus } from "./generated/enums.js";
export const router = Router();
router.use("/api/v1/shipments", authenticate(config.JWT_SECRET), authorize("ADMIN"));
router.get("/api/v1/shipments", asyncHandler(async (_req, res) => res.json({ success: true, data: await prisma.shipment.findMany({ orderBy: { createdAt: "desc" } }) })));
router.patch("/api/v1/shipments/:id/status", asyncHandler(async (req, res) => {
  const status = z.enum(ShipmentStatus).parse(req.body.status);
  res.json({ success: true, data: await prisma.shipment.update({ where: { id: Number(req.params.id) }, data: { status } }) });
}));
