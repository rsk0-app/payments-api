import { Router } from "express";
import { randomUUID } from "crypto";

type Charge = {
  id: string;
  amount: number;
  currency: string;
  status: "pending" | "captured";
};

const store = new Map<string, Charge>();

export const chargesRouter = Router();

chargesRouter.post("/", (req, res) => {
  const { amount, currency } = req.body ?? {};
  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }
  const charge: Charge = {
    id: randomUUID(),
    amount,
    currency: currency ?? "usd",
    status: "pending",
  };
  store.set(charge.id, charge);
  return res.status(201).json(charge);
});

chargesRouter.get("/:id", (req, res) => {
  const charge = store.get(req.params.id);
  if (!charge) return res.status(404).json({ error: "not found" });
  return res.json(charge);
});

chargesRouter.post("/:id/capture", (req, res) => {
  const charge = store.get(req.params.id);
  if (!charge) return res.status(404).json({ error: "not found" });
  charge.status = "captured";
  return res.json(charge);
});
