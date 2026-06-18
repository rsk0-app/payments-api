import { Router } from "express";
import { ChargeStore } from "./store";
import { ChargeNotFoundError, InvalidAmountError, AlreadyCapturedError } from "./errors";
import { inc } from "./metrics";
import { idempotency } from "./idempotency";

const store = new ChargeStore();
export const chargesRouter = Router();

chargesRouter.post("/", idempotency, (req, res) => {
  try {
    const charge = store.create(req.body ?? {});
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

chargesRouter.get("/:id", (req, res) => {
  try {
    return res.json(store.get(req.params.id));
  } catch (err) {
    if (err instanceof ChargeNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    throw err;
  }
});

chargesRouter.post("/:id/capture", (req, res) => {
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
