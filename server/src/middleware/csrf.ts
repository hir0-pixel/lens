import { NextFunction, Request, Response } from "express";
import { getConfig } from "../config";
import { timingSafeCompare } from "../utils/crypto";

export interface CsrfError extends Error {}

export function csrfProtection(options: {
  getSessionCsrf: (cookieValue: string | undefined) => string | undefined;
}): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      next();
      return;
    }
    const cfg = getConfig();
    const sessionCookie = req.cookies?.[cfg.SESSION_COOKIE_NAME];
    const expected = options.getSessionCsrf(sessionCookie);
    const supplied = req.headers[cfg.CSRF_HEADER_NAME.toLowerCase()] as string | undefined;
    if (!expected || !supplied || !timingSafeCompare(expected, supplied)) {
      res.status(403).json({ error: "CSRF_REJECTED" });
      return;
    }
    next();
  };
}
