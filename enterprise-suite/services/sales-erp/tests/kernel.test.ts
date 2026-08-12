import test from "node:test";
import assert from "node:assert/strict";
import {
  addMoney,
  compareMoney,
  money,
  percentOf,
  subMoney,
  sumMoney,
  zeroMoney,
} from "../src/kernel/money.js";
import {
  assertTransition,
  canTransition,
  isTerminal,
  reachableStates,
  type StateMachineDef,
} from "../src/kernel/state-machine.js";
import { InvalidTransitionError, ValidationError } from "../src/kernel/errors.js";
import { normalizePage, paginate } from "../src/kernel/pagination.js";
import {
  parse,
  vArray,
  vEnum,
  vInt,
  vIsoDate,
  vObject,
  vOptional,
  vString,
} from "../src/application/validation/validator.js";

test("money: integer minor units are enforced", () => {
  assert.throws(() => money(10.5, "EUR"), /integer minor units/);
  assert.equal(money(1050, "eur").currency, "EUR");
});

test("money: arithmetic and currency safety", () => {
  const a = money(1000, "EUR");
  const b = money(250, "EUR");
  assert.equal(addMoney(a, b).amountMinor, 1250);
  assert.equal(subMoney(a, b).amountMinor, 750);
  assert.throws(() => addMoney(a, money(1, "USD")), /Currency mismatch/);
  assert.equal(compareMoney(a, b), 1);
  assert.equal(sumMoney([a, b, zeroMoney("EUR")], "EUR").amountMinor, 1250);
});

test("money: percentOf rounds half away from zero at minor units", () => {
  assert.equal(percentOf(money(44850, "EUR"), 19).amountMinor, 8522); // 8521.5 -> 8522
  assert.equal(percentOf(money(1000, "EUR"), 2.5).amountMinor, 25);
  assert.equal(percentOf(money(0, "EUR"), 19).amountMinor, 0);
});

const TRAFFIC_LIGHT: StateMachineDef<"red" | "green" | "off"> = {
  name: "TrafficLight",
  initial: "red",
  transitions: { red: ["green"], green: ["red", "off"], off: [] },
};

test("state machine: transitions, terminal states, reachability", () => {
  assert.equal(canTransition(TRAFFIC_LIGHT, "red", "green"), true);
  assert.equal(canTransition(TRAFFIC_LIGHT, "red", "off"), false);
  assert.throws(() => assertTransition(TRAFFIC_LIGHT, "off", "red"), InvalidTransitionError);
  assert.equal(isTerminal(TRAFFIC_LIGHT, "off"), true);
  assert.deepEqual([...reachableStates(TRAFFIC_LIGHT, "red")].sort(), ["green", "off"]);
});

test("pagination: normalization clamps and slices", () => {
  const req = normalizePage({ page: 0, pageSize: 10_000 });
  assert.equal(req.page, 1);
  assert.equal(req.pageSize, 200);
  const page = paginate([1, 2, 3, 4, 5], normalizePage({ page: 2, pageSize: 2 }));
  assert.deepEqual([...page.items], [3, 4]);
  assert.equal(page.total, 5);
  assert.equal(page.nextCursor, "3");
});

test("validator: object schema collects nested field errors with paths", () => {
  const schema = vObject({
    name: vString({ min: 1 }),
    qty: vInt({ min: 1 }),
    tags: vOptional(vArray(vString({ min: 2 }))),
    kind: vEnum(["a", "b"]),
    when: vOptional(vIsoDate()),
  });
  try {
    parse(schema, { name: "", qty: 0, tags: ["ok", "x"], kind: "c", when: "2025-13-99" });
    assert.fail("expected ValidationError");
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    const paths = error.fieldErrors.map((e) => e.path).sort();
    assert.deepEqual(paths, ["$.kind", "$.name", "$.qty", "$.tags[1]", "$.when"]);
  }
});

test("validator: happy path trims strings and applies optional semantics", () => {
  const schema = vObject({ name: vString({ min: 1 }), note: vOptional(vString()) });
  const parsed = parse(schema, { name: "  Acme  ", note: null });
  assert.equal(parsed.name, "Acme");
  assert.equal("note" in parsed, false);
});
