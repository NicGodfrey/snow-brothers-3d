import assert from "node:assert/strict";
import { test } from "node:test";
import { KeyLock, Semaphore } from "../src/limiter.ts";

test("semaphore never exceeds max and transfers permits to waiters", async () => {
  const sem = new Semaphore(2);
  let current = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 20 }, async () => {
      await sem.acquire();
      current += 1;
      peak = Math.max(peak, current);
      await new Promise((r) => setTimeout(r, 5));
      current -= 1;
      sem.release();
    }),
  );
  assert.ok(peak <= 2);
  assert.equal(sem.inFlight, 0);
});

test("key lock serializes the same agent", async () => {
  const lock = new KeyLock();
  const order: string[] = [];
  await Promise.all([
    lock.run("a", async () => {
      order.push("a1");
      await new Promise((r) => setTimeout(r, 15));
      order.push("a2");
    }),
    lock.run("a", async () => {
      order.push("a3");
    }),
    lock.run("b", async () => {
      order.push("b");
    }),
  ]);
  assert.ok(order.includes("b"));
  assert.ok(order.indexOf("a1") < order.indexOf("a2"));
  assert.ok(order.indexOf("a2") < order.indexOf("a3"));
});
