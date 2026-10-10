import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../../shared/auth.js";
import { asyncHandler } from "../../../shared/http.js";
import { AppError } from "../../../shared/app-error.js";
import type { KafkaBus } from "../../../shared/kafka.js";
import { config } from "./config.js";
import { prisma } from "./db.js";

async function internalJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", "x-internal-api-key": config.INTERNAL_API_KEY, ...init?.headers } });
  if (!response.ok) throw new AppError(response.status === 404 ? 400 : 503, `Service phụ thuộc trả về ${response.status}`);
  return response.json();
}
export function createRouter(kafka: KafkaBus) {
  const router = Router(); router.use("/api/v1/orders", authenticate(config.JWT_SECRET));
  router.post("/api/v1/orders", asyncHandler(async (req, res) => {
    const items = z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().positive().max(1000) })).min(1).refine((rows) => new Set(rows.map((x) => x.productId)).size === rows.length, "Sản phẩm bị trùng").parse(req.body.items);
    const [discount, products] = await Promise.all([
      internalJson(`${config.AUTH_URL}/internal/users/${req.auth!.userId}/discount`) as Promise<{ score: number; percent: number }>,
      internalJson(`${config.CATALOG_URL}/internal/products/snapshot`, { method: "POST", body: JSON.stringify({ ids: items.map((x) => x.productId) }) }) as Promise<Array<{ id: number; name: string; price: string }>>
    ]);
    const map = new Map(products.map((x) => [x.id, x]));
    const subtotalCents = items.reduce((sum, item) => sum + Math.round(Number(map.get(item.productId)!.price) * 100) * item.quantity, 0);
    const discountCents = Math.round(subtotalCents * discount.percent / 100);
    const order = await prisma.order.create({ data: {
      userId: req.auth!.userId, subtotal: (subtotalCents / 100).toFixed(2), discountPercent: discount.percent,
      discountAmount: (discountCents / 100).toFixed(2), total: ((subtotalCents - discountCents) / 100).toFixed(2), scoreSnapshot: discount.score,
      lines: { create: items.map((item) => ({ productId: item.productId, productName: map.get(item.productId)!.name, quantity: item.quantity, unitPrice: map.get(item.productId)!.price })) }
    }, include: { lines: true } });
    await kafka.publish("order.created", { orderId: order.id, userId: order.userId, items: order.lines.map((x) => ({ productId: x.productId, quantity: x.quantity })) });
    res.status(202).json({ success: true, data: order, message: "Saga đang xử lý giữ tồn kho" });
  }));
  router.get("/api/v1/orders", asyncHandler(async (req, res) => {
    const where = req.auth!.role === "ADMIN" ? {} : { userId: req.auth!.userId };
    res.json({ success: true, data: await prisma.order.findMany({ where, include: { lines: true }, orderBy: { createdAt: "desc" } }) });
  }));
  router.get("/api/v1/orders/:id", asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { id: Number(req.params.id) }, include: { lines: true } });
    if (!order) throw new AppError(404, "Không tìm thấy đơn hàng");
    if (req.auth!.role !== "ADMIN" && order.userId !== req.auth!.userId) throw new AppError(403, "Không đủ quyền");
    res.json({ success: true, data: order });
  }));
  router.post("/api/v1/orders/:id/cancel", asyncHandler(async (req, res) => {
    const current = await prisma.order.findUnique({ where: { id: Number(req.params.id) } });
    if (!current) throw new AppError(404, "Không tìm thấy đơn hàng");
    if (req.auth!.role !== "ADMIN" && current.userId !== req.auth!.userId) throw new AppError(403, "Không đủ quyền");
    if (current.status !== "PENDING") throw new AppError(409, "Chỉ có thể hủy đơn đang PENDING");
    const order = await prisma.order.update({ where: { id: current.id }, data: { status: "CANCELLED", failureReason: "Người dùng hủy" } });
    await kafka.publish("order.cancelled", { orderId: order.id, reason: order.failureReason }); res.json({ success: true, data: order });
  }));
  return router;
}
