import test from "node:test";
import assert from "node:assert/strict";
import { ConflictError, InvalidTransitionError, ValidationError } from "../src/kernel/index.js";
import { OpportunityEventTypes } from "../src/domain/opportunities/events.js";
import { makeAccount, makeModule, repCtx } from "./helpers.js";

function setup() {
  const { module } = makeModule();
  const ctx = repCtx();
  const accountId = makeAccount(module, ctx);
  const opp = module.opportunities.create(ctx, {
    accountId: accountId as unknown as string,
    name: "Big deal",
    amountMinor: 100_000,
    currency: "EUR",
  });
  return { module, ctx, accountId, opp };
}

test("opportunities: created in prospecting with stage probability", () => {
  const { opp } = setup();
  assert.equal(opp.stage, "prospecting");
  assert.equal(opp.probability, 10);
  assert.equal(opp.weightedAmountMinor, 10_000);
});

test("opportunities: advance walks the open stages and stops at negotiation", () => {
  const { module, ctx, opp } = setup();
  module.opportunities.advanceStage(ctx, opp.id); // qualification
  module.opportunities.advanceStage(ctx, opp.id); // proposal
  module.opportunities.advanceStage(ctx, opp.id); // negotiation
  assert.equal(module.opportunities.get(ctx, opp.id).stage, "negotiation");
  assert.throws(() => module.opportunities.advanceStage(ctx, opp.id), ConflictError);
});

test("opportunities: moveStage allows backward moves but not closing", () => {
  const { module, ctx, opp } = setup();
  module.opportunities.moveStage(ctx, opp.id, { stage: "negotiation" });
  module.opportunities.moveStage(ctx, opp.id, { stage: "qualification" });
  assert.equal(module.opportunities.get(ctx, opp.id).stage, "qualification");
  assert.throws(() => module.opportunities.moveStage(ctx, opp.id, { stage: "closed_won" }), ValidationError);
});

test("opportunities: win and lose are terminal and evented", () => {
  const { module, ctx, opp } = setup();
  module.opportunities.win(ctx, opp.id);
  const won = module.opportunities.get(ctx, opp.id);
  assert.equal(won.stage, "closed_won");
  assert.equal(won.probability, 100);
  assert.throws(() => module.opportunities.advanceStage(ctx, opp.id), ConflictError);
  assert.throws(() => module.opportunities.lose(ctx, opp.id, { reason: "changed mind" }), InvalidTransitionError);
  assert.equal(module.outbox.byType(OpportunityEventTypes.OpportunityWon).length, 1);

  const { module: m2, ctx: ctx2, opp: opp2 } = setup();
  m2.opportunities.lose(ctx2, opp2.id, { reason: "lost to competitor" });
  assert.equal(m2.opportunities.get(ctx2, opp2.id).stage, "closed_lost");
  assert.throws(() => m2.opportunities.reviseAmount(ctx2, opp2.id, { amountMinor: 5 }), ConflictError);
});

test("opportunities: pipeline summary aggregates open stages with weighting", () => {
  const { module, ctx, accountId } = setup(); // one prospecting opp @100000
  const second = module.opportunities.create(ctx, {
    accountId: accountId as unknown as string,
    name: "Second",
    amountMinor: 50_000,
    currency: "EUR",
  });
  module.opportunities.moveStage(ctx, second.id, { stage: "negotiation" });
  const lost = module.opportunities.create(ctx, {
    accountId: accountId as unknown as string,
    name: "Third",
    amountMinor: 70_000,
    currency: "EUR",
  });
  module.opportunities.lose(ctx, lost.id, { reason: "no budget" });

  const summary = module.opportunities.pipelineSummary(ctx);
  assert.equal(summary.openCount, 2);
  assert.equal(summary.openTotalMinor, 150_000);
  // 100000*10% + 50000*75%
  assert.equal(summary.weightedTotalMinor, 10_000 + 37_500);
  const negotiation = summary.stages.find((s) => s.stage === "negotiation");
  assert.equal(negotiation?.count, 1);
});
