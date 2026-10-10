import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "./app-error.js";
export const asyncHandler = (handler: RequestHandler): RequestHandler =>
  (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
export const notFound: RequestHandler = (req, _res, next) => next(new AppError(404, `Không tìm thấy ${req.method} ${req.originalUrl}`));
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const status = error instanceof AppError ? error.statusCode : 500;
  if (status === 500) console.error(error);
  res.status(status).json({ success: false, error: error instanceof Error ? error.message : "Lỗi hệ thống" });
};
