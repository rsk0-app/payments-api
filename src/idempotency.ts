/**
 * Idempotency-key middleware. Replays the stored response for a repeated
 * Idempotency-Key header instead of creating a duplicate charge.
 */
import type { Request, Response, NextFunction } from "express";

interface StoredResponse {
  status: number;
  body: unknown;
}

const seen = new Map<string, StoredResponse>();

export function idempotency(req: Request, res: Response, next: NextFunction): void {
  const key = req.header("Idempotency-Key");
  if (!key) return next();

  const prior = seen.get(key);
  if (prior) {
    res.status(prior.status).json(prior.body);
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    seen.set(key, { status: res.statusCode, body });
    return originalJson(body);
  };
  next();
}
