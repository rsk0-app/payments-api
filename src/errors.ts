export class ChargeNotFoundError extends Error {
  constructor(id: string) {
    super(`charge ${id} not found`);
    this.name = "ChargeNotFoundError";
  }
}

export class InvalidAmountError extends Error {
  constructor() {
    super("amount must be a positive number");
    this.name = "InvalidAmountError";
  }
}

export class AlreadyCapturedError extends Error {
  constructor(id: string) {
    super(`charge ${id} already captured`);
    this.name = "AlreadyCapturedError";
  }
}
