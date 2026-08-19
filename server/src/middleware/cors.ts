import { NextFunction, Request, Response } from "express";
import { getAllowedOrigins } from "../config";

export function corsMiddleware(originHeader?: string): (req: Request, res: Response, next: NextFunction) => void {
  const allowedOrigins = getAllowedOrigins();
  return (req, res, next) => {
    const origin = originHeader ?? req.headers.origin;
    if (!origin) {
      next();
      return;
    }
    if (!allowedOrigins.includes(origin)) {
      res.status(403).json({ error: "ORIGIN_FORBIDDEN" });
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Lens-CSRF, X-Requested-With",
    );
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}
