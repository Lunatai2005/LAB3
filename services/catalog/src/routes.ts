import { Router } from "express";
import { z } from "zod";
import { Prisma } from "./generated/client.js";
import { authenticate, authorize } from "../../../shared/auth.js";
import { asyncHandler } from "../../../shared/http.js";
import { AppError } from "../../../shared/app-error.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
export const router = Router();
const auth = authenticate(config.JWT_SECRET);
const bodySchema = z.object({ name: z.string().trim().min(2).max(100), price: z.coerce.number().positive(), quantity: z.coerce.number().int().nonnegative() });
router.get("/api/v1/products", asyncHandler(async (req, res) => {
  const q = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().optional() }).parse(req.query);
  const where = q.search ? { name: { contains: q.search, mode: Prisma.QueryMode.insensitive } } : {};
  const [items, total] = await prisma.$transaction([prisma.product.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { id: "asc" } }), prisma.product.count({ where })]);
  res.json({ success: true, data: items, meta: { ...q, total } });
}));
router.get("/api/v1/products/:id", asyncHandler(async (req, res) => {
  const item = await prisma.product.findUnique({ where: { id: z.coerce.number().int().positive().parse(req.params.id) } });
  if (!item) throw new AppError(404, "Không tìm thấy sản phẩm"); res.json({ success: true, data: item });
}));
router.post("/api/v1/products", auth, authorize("ADMIN"), asyncHandler(async (req, res) => res.status(201).json({ success: true, data: await prisma.product.create({ data: bodySchema.parse(req.body) }) })));
router.patch("/api/v1/products/:id", auth, authorize("ADMIN"), asyncHandler(async (req, res) => res.json({ success: true, data: await prisma.product.update({ where: { id: Number(req.params.id) }, data: bodySchema.partial().parse(req.body) }) })));
router.delete("/api/v1/products/:id", auth, authorize("ADMIN"), asyncHandler(async (req, res) => { await prisma.product.delete({ where: { id: Number(req.params.id) } }); res.status(204).send(); }));
router.post("/internal/products/snapshot", asyncHandler(async (req, res) => {
  if (req.header("x-internal-api-key") !== config.INTERNAL_API_KEY) throw new AppError(401, "Internal key không hợp lệ");
  const ids = z.array(z.number().int().positive()).min(1).parse(req.body.ids);
  const products = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, price: true } });
  if (products.length !== new Set(ids).size) throw new AppError(400, "Có sản phẩm không tồn tại"); res.json(products);
}));
