import { randomUUID } from "crypto";
import { ChargeNotFoundError, InvalidAmountError, AlreadyCapturedError } from "./errors";

export type ChargeStatus = "pending" | "captured" | "failed";

export interface Charge {
  id: string;
  amount: number;
  currency: string;
  status: ChargeStatus;
  createdAt: string;
  capturedAt?: string;
  metadata: Record<string, string>;
}

export interface CreateChargeInput {
  amount: number;
  currency?: string;
  metadata?: Record<string, string>;
}

/**
 * In-memory charge store. Production would swap this for a Postgres-backed
 * repository, but the interface stays the same.
 */
export class ChargeStore {
  private readonly charges = new Map<string, Charge>();

  create(input: CreateChargeInput): Charge {
    if (typeof input.amount !== "number" || input.amount <= 0) {
      throw new InvalidAmountError();
    }
    const charge: Charge = {
      id: randomUUID(),
      amount: input.amount,
      currency: input.currency ?? "usd",
      status: "pending",
      createdAt: new Date().toISOString(),
      metadata: input.metadata ?? {},
    };
    this.charges.set(charge.id, charge);
    return charge;
  }

  get(id: string): Charge {
    const charge = this.charges.get(id);
    if (!charge) throw new ChargeNotFoundError(id);
    return charge;
  }

  capture(id: string): Charge {
    const charge = this.get(id);
    if (charge.status === "captured") {
      throw new AlreadyCapturedError(id);
    }
    charge.status = "captured";
    charge.capturedAt = new Date().toISOString();
    return charge;
  }

  list(): Charge[] {
    return [...this.charges.values()];
  }

  get size(): number {
    return this.charges.size;
  }
}
