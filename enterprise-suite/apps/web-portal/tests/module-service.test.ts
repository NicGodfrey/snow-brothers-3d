import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ForbiddenError, NotFoundError } from "@enterprise-suite/shared-kernel";
import { humanize, inferColumns } from "../src/application/module-service.js";
import { createHarness, USERS } from "./helpers.js";

const harness = createHarness();

describe("module list views", () => {
  it("infers columns and formats money, percent and dates", async () => {
    const session = harness.session(USERS.salesManager, "acme");
    const view = await harness.container
      .forSession(session)
      .modules.loadList(session, "sales", "quotes");

    assert.equal(view.moduleLabel, "Sales");
    assert.equal(view.total, 5);
    const byKey = Object.fromEntries(view.columns.map((c) => [c.key, c]));
    assert.equal(byKey.total?.kind, "money");
    assert.equal(byKey.total?.align, "right");
    assert.equal(byKey.discountPct?.kind, "percent");
    assert.equal(byKey.validUntil?.kind, "date");
    assert.equal(byKey.id, undefined, "the id column is not rendered");

    const cells = Object.fromEntries(
      view.columns.map((column, index) => [column.key, view.rows[0]!.cells[index]!.text]),
    );
    assert.equal(cells.total, "$4,250.00");
    assert.equal(cells.discountPct, "5.0%");
    assert.match(cells.validUntil ?? "", /^\d{4}-\d{2}-\d{2}$/);
  });

  it("passes filters and paging through to the service", async () => {
    const session = harness.session(USERS.salesManager, "acme");
    const view = await harness.container
      .forSession(session)
      .modules.loadList(session, "sales", "quotes", { q: "initech", pageSize: 1 });
    assert.equal(view.total, 1);
    assert.equal(view.pageSize, 1);
    assert.equal(view.rows.length, 1);
  });

  it("offers only the actions the session may run", async () => {
    const salesManager = harness.session(USERS.salesManager, "acme");
    const managerView = await harness.container
      .forSession(salesManager)
      .modules.loadList(salesManager, "sales", "quotes");
    assert.deepEqual(
      managerView.actions.map((a) => a.key),
      ["sales.quote.create", "sales.quote.approve"],
    );

    const buyer = harness.session(USERS.buyer, "acme");
    const buyerView = await harness.container
      .forSession(buyer)
      .modules.loadList(buyer, "sales", "quotes");
    assert.deepEqual(buyerView.actions, []);
    assert.equal(buyerView.canWrite, false);
  });

  it("refuses views the role cannot open", async () => {
    const buyer = harness.session(USERS.buyer, "acme");
    await assert.rejects(
      harness.container.forSession(buyer).modules.loadList(buyer, "sales", "approvals"),
      ForbiddenError,
    );
  });

  it("treats an unentitled module as absent, not forbidden", async () => {
    const globex = harness.session(USERS.admin, "globex");
    await assert.rejects(
      harness.container.forSession(globex).modules.loadList(globex, "prm", "partners"),
      NotFoundError,
    );
  });

  it("rejects unknown modules and views", async () => {
    const session = harness.session(USERS.admin, "acme");
    const modules = harness.container.forSession(session).modules;
    await assert.rejects(modules.loadList(session, "hr", "people"), NotFoundError);
    await assert.rejects(modules.loadList(session, "sales", "nope"), NotFoundError);
  });
});

describe("module actions", () => {
  it("dispatches a declared action to the owning service", async () => {
    const session = harness.session(USERS.salesManager, "acme");
    const result = (await harness.container
      .forSession(session)
      .modules.runAction(session, "sales", "sales.quote.approve", { approvedPct: 0.15 }, "key-1")) as {
      command: string;
      echo: unknown;
    };
    assert.equal(result.command, "POST /approvals");
    assert.deepEqual(result.echo, { approvedPct: 0.15 });

    const call = harness.transport.calls.at(-1);
    assert.equal(call?.module, "sales");
    assert.equal(call?.tenantId, "acme");
  });

  it("refuses undeclared actions and unauthorised ones", async () => {
    const session = harness.session(USERS.salesManager, "acme");
    const modules = harness.container.forSession(session).modules;
    await assert.rejects(modules.runAction(session, "sales", "sales.quote.delete", {}), NotFoundError);

    const buyer = harness.session(USERS.buyer, "acme");
    await assert.rejects(
      harness.container
        .forSession(buyer)
        .modules.runAction(buyer, "sales", "sales.quote.create", {}),
      ForbiddenError,
    );
  });
});

describe("column inference", () => {
  it("skips arrays, right-aligns numbers and humanises keys", () => {
    const columns = inferColumns([
      {
        id: "1",
        supplierName: "Kraftwerk",
        onTimeDeliveryPct: 0.96,
        contractCount: 2,
        autoRenew: true,
        categories: ["wheels"],
      },
    ]);
    assert.deepEqual(
      columns.map((c) => [c.key, c.kind, c.align]),
      [
        ["supplierName", "text", "left"],
        ["onTimeDeliveryPct", "percent", "right"],
        ["contractCount", "number", "right"],
        ["autoRenew", "boolean", "left"],
      ],
    );
    assert.equal(columns[0]!.label, "Supplier name");
    assert.deepEqual(inferColumns([]), []);
  });

  it("humanises camelCase, kebab-case and snake_case", () => {
    assert.equal(humanize("daysSalesOutstanding"), "Days sales outstanding");
    assert.equal(humanize("purchase-orders"), "Purchase orders");
    assert.equal(humanize("cost_center"), "Cost center");
  });
});
