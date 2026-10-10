import type { RequestHandler } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { AppError } from "./app-error.js";
declare global { namespace Express { interface Request { auth?: { userId: number; role: string } } } }
export const authenticate = (secret: string): RequestHandler => (req, _res, next) => {
  const value = req.headers.authorization;
  if (!value?.startsWith("Bearer ")) return next(new AppError(401, "Thiếu access token"));
  try {
    const payload = jwt.verify(value.slice(7), secret) as JwtPayload & { role?: string };
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || !payload.role) throw new Error();
    req.auth = { userId, role: payload.role }; next();
  } catch { next(new AppError(401, "Access token không hợp lệ hoặc đã hết hạn")); }
};
export const authorize = (...roles: string[]): RequestHandler => (req, _res, next) =>
  req.auth && roles.includes(req.auth.role) ? next() : next(new AppError(403, "Không đủ quyền"));
