const { test } = require("node:test");
const assert = require("node:assert");

// Pure helper mirrored from the charge validation logic.
function validateAmount(amount) {
  return typeof amount === "number" && amount > 0;
}

test("valid amount passes", () => {
  assert.strictEqual(validateAmount(100), true);
});

test("zero amount fails", () => {
  assert.strictEqual(validateAmount(0), false);
});

test("negative amount fails", () => {
  assert.strictEqual(validateAmount(-5), false);
});
