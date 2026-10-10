import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { asyncHandler } from "../../../shared/http.js";
import { AppError } from "../../../shared/app-error.js";
import { authenticate } from "../../../shared/auth.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { discountForScore } from "./discount.js";

export const router = Router();
const token = (id: number, role: string) => jwt.sign({ role }, config.JWT_SECRET, { subject: String(id), expiresIn: config.JWT_EXPIRES_IN as SignOptions["expiresIn"] });
router.post("/api/v1/auth/register", asyncHandler(async (req, res) => {
  const body = z.object({ username: z.string().trim().min(3).max(50), fullName: z.string().trim().min(2).max(100), password: z.string().min(8).max(72) }).parse(req.body);
  if (await prisma.user.findUnique({ where: { username: body.username } })) throw new AppError(409, "Tên đăng nhập đã tồn tại");
  const user = await prisma.user.create({ data: { username: body.username, fullName: body.fullName, passwordHash: await bcrypt.hash(body.password, 12) } });
  res.status(201).json({ success: true, data: { user: { id: user.id, username: user.username, fullName: user.fullName }, accessToken: token(user.id, user.role) } });
}));
router.post("/api/v1/auth/login", asyncHandler(async (req, res) => {
  const body = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { username: body.username } });
  if (!user || !await bcrypt.compare(body.password, user.passwordHash)) throw new AppError(401, "Tên đăng nhập hoặc mật khẩu không đúng");
  res.json({ success: true, data: { accessToken: token(user.id, user.role), user: { id: user.id, username: user.username, role: user.role } } });
}));
router.get("/api/v1/auth/me", authenticate(config.JWT_SECRET), asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { id: true, username: true, fullName: true, role: true, score: true } });
  if (!user) throw new AppError(404, "Không tìm thấy người dùng");
  res.json({ success: true, data: { ...user, membership: discountForScore(user.score) } });
}));
router.get("/internal/users/:id/discount", asyncHandler(async (req, res) => {
  if (req.header("x-internal-api-key") !== config.INTERNAL_API_KEY) throw new AppError(401, "Internal key không hợp lệ");
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const user = await prisma.user.findUnique({ where: { id }, select: { score: true } });
  if (!user) throw new AppError(404, "Không tìm thấy người dùng");
  res.json({ score: user.score, ...discountForScore(user.score) });
}));
