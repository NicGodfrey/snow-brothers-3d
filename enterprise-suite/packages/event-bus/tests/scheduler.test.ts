import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ImmediateScheduler, ManualScheduler, TimerScheduler, tick } from "../src/scheduler.js";

describe("ManualScheduler", () => {
  it("runs nothing until time is advanced", async () => {
    const scheduler = new ManualScheduler();
    let ran = false;
    scheduler.schedule(100, () => {
      ran = true;
    });

    assert.equal(scheduler.pending, 1);
    await tick();
    assert.equal(ran, false);

    await scheduler.advanceBy(99);
    assert.equal(ran, false);
    await scheduler.advanceBy(1);
    assert.equal(ran, true);
    assert.equal(scheduler.now, 100);
    assert.equal(scheduler.pending, 0);
  });

  it("fires tasks in due order, ties broken by registration", async () => {
    const scheduler = new ManualScheduler();
    const order: string[] = [];
    scheduler.schedule(30, () => order.push("c"));
    scheduler.schedule(10, () => order.push("a"));
    scheduler.schedule(10, () => order.push("b"));

    await scheduler.advanceBy(30);
    assert.deepEqual(order, ["a", "b", "c"]);
  });

  it("runs tasks scheduled from inside a task", async () => {
    const scheduler = new ManualScheduler();
    const order: number[] = [];
    const chain = (step: number): void => {
      order.push(step);
      if (step < 3) scheduler.schedule(10, () => chain(step + 1));
    };
    scheduler.schedule(10, () => chain(1));

    await scheduler.runAll();
    assert.deepEqual(order, [1, 2, 3]);
    assert.equal(scheduler.now, 30);
  });

  it("does not fire a cancelled task", async () => {
    const scheduler = new ManualScheduler();
    let ran = false;
    const cancel = scheduler.schedule(10, () => {
      ran = true;
    });
    cancel();

    assert.equal(scheduler.pending, 0);
    await scheduler.advanceBy(100);
    assert.equal(ran, false);
  });

  it("reports pending delays relative to the current virtual time", async () => {
    const scheduler = new ManualScheduler();
    scheduler.schedule(50, () => {});
    scheduler.schedule(200, () => {});

    assert.deepEqual(scheduler.pendingDelays(), [50, 200]);
    await scheduler.advanceBy(50);
    assert.deepEqual(scheduler.pendingDelays(), [150]);
  });

  it("treats a negative delay as due immediately", async () => {
    const scheduler = new ManualScheduler();
    let ran = false;
    scheduler.schedule(-5, () => {
      ran = true;
    });
    await scheduler.advanceBy(0);
    assert.equal(ran, true);
  });

  it("gives up rather than spinning on a self-perpetuating task", async () => {
    const scheduler = new ManualScheduler();
    const reschedule = (): void => {
      scheduler.schedule(1, reschedule);
    };
    scheduler.schedule(1, reschedule);

    await assert.rejects(() => scheduler.runAll(5), /exceeded 5 rounds/);
  });
});

describe("ImmediateScheduler", () => {
  it("runs on the microtask queue while recording the requested delays", async () => {
    const scheduler = new ImmediateScheduler();
    const order: string[] = [];
    scheduler.schedule(5_000, () => order.push("slow"));
    scheduler.schedule(1, () => order.push("fast"));

    assert.deepEqual(order, []);
    await tick();

    // Delay is recorded but not honoured, so registration order wins.
    assert.deepEqual(order, ["slow", "fast"]);
    assert.deepEqual(scheduler.observedDelays, [5_000, 1]);
  });

  it("honours cancellation before the microtask runs", async () => {
    const scheduler = new ImmediateScheduler();
    let ran = false;
    scheduler.schedule(10, () => {
      ran = true;
    })();

    await tick();
    assert.equal(ran, false);
  });
});

describe("TimerScheduler", () => {
  it("fires after the delay and can be cancelled", async () => {
    const scheduler = new TimerScheduler();
    const fired: string[] = [];
    scheduler.schedule(1, () => fired.push("kept"));
    scheduler.schedule(1, () => fired.push("cancelled"))();

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(fired, ["kept"]);
  });
});
