import assert from "node:assert/strict";
import { test } from "node:test";
import { StreamWatchdog } from "../src/lucy/watchdog.ts";

test("watchdog fires after idle timeout and touch resets it", async () => {
  let stalled = 0;
  const dog = new StreamWatchdog(40, () => {
    stalled += 1;
  });
  dog.start();
  await sleep(25);
  dog.touch();
  await sleep(25);
  assert.equal(stalled, 0);
  await sleep(30);
  assert.equal(stalled, 1);
  dog.touch();
  await sleep(50);
  assert.equal(stalled, 1);
  dog.stop();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
