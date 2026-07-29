import { Router } from "express";
import { ChargeStore } from "./store";
import { ChargeNotFoundError, InvalidAmountError, AlreadyCapturedError } from "./errors";
import { inc } from "./metrics";
import { dbEnabled, dbCreateCharge, dbGetCharge, dbCaptureCharge } from "./db";

const store = new ChargeStore();
export const chargesRouter = Router();

function validAmount(v: unknown): v is number {
  return typeof v === "number" && v > 0;
}

// POST /charges — the main business path. With a DB it does a REAL write+read
// against the charges table; a DB/query error surfaces as a real 500 (so a broken
// schema is a real failure). DATABASE_URL empty => in-memory fallback.
chargesRouter.post("/", async (req, res) => {
  const body = req.body ?? {};
  if (!validAmount(body.amount)) {
    inc("charges_rejected_total");
    return res.status(400).json({ error: "amount must be a positive number" });
  }

  if (dbEnabled()) {
    try {
      const charge = await dbCreateCharge(body.amount, body.currency ?? "usd");
      inc("charges_created_total");
      return res.status(201).json(charge);
    } catch {
      inc("charges_db_error_total");
      return res.status(500).json({ error: "charge persistence failed" });
    }
  }

  try {
    const charge = store.create(body);
    inc("charges_created_total");
    return res.status(201).json(charge);
  } catch (err) {
    if (err instanceof InvalidAmountError) {
      inc("charges_rejected_total");
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
});

chargesRouter.get("/:id", async (req, res) => {
  if (dbEnabled()) {
    try {
      const charge = await dbGetCharge(req.params.id);
      if (!charge) return res.status(404).json({ error: "charge not found" });
      return res.json(charge);
    } catch {
      inc("charges_db_error_total");
      return res.status(500).json({ error: "charge lookup failed" });
    }
  }
  try {
    return res.json(store.get(req.params.id));
  } catch (err) {
    if (err instanceof ChargeNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    throw err;
  }
});

chargesRouter.post("/:id/capture", async (req, res) => {
  if (dbEnabled()) {
    try {
      const result = await dbCaptureCharge(req.params.id);
      if (result === null) return res.status(404).json({ error: "charge not found" });
      if (result === "already") return res.status(409).json({ error: "charge already captured" });
      inc("charges_captured_total");
      return res.json(result);
    } catch {
      inc("charges_db_error_total");
      return res.status(500).json({ error: "charge capture failed" });
    }
  }
  try {
    const charge = store.capture(req.params.id);
    inc("charges_captured_total");
    return res.json(charge);
  } catch (err) {
    if (err instanceof ChargeNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    if (err instanceof AlreadyCapturedError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }
});
