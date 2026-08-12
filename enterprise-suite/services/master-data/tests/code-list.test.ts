import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CodeList, diffVersions } from "../src/domain/code-list.js";
import { expectRejects, expectThrows, world } from "./helpers.js";
import type { TenantId, UserId } from "@enterprise-suite/shared-kernel";

const TENANT = "acme" as TenantId;
const STEWARD = "steward-1" as UserId;
const AT = "2026-01-01T00:00:00.000Z" as never;

function flatList(): CodeList {
  const list = CodeList.create(TENANT, { listCode: "block_reason", name: "Block reason" });
  list.upsertEntry({ code: "credit", label: "Credit limit exceeded", sortOrder: 1 });
  list.upsertEntry({ code: "overdue", label: "Overdue receivables", sortOrder: 2 });
  list.pullEvents();
  return list;
}

function hierarchy(): CodeList {
  const list = CodeList.create(TENANT, {
    listCode: "industry",
    name: "Industry",
    hierarchical: true,
  });
  list.upsertEntry({ code: "MFG", label: "Manufacturing", sortOrder: 1 });
  list.upsertEntry({ code: "MFG.AUTO", label: "Automotive", parentCode: "MFG", sortOrder: 2 });
  list.upsertEntry({ code: "MFG.AUTO.OEM", label: "OEM", parentCode: "MFG.AUTO", sortOrder: 3 });
  list.upsertEntry({ code: "RETAIL", label: "Retail", sortOrder: 4 });
  list.publishDraft("2026-01-01", STEWARD, AT);
  list.pullEvents();
  return list;
}

describe("code list drafting", () => {
  it("starts life as an empty draft that cannot be published", () => {
    const list = CodeList.create(TENANT, { listCode: "reason", name: "Reason" });
    assert.equal(list.draft()?.version, 1);
    assert.equal(list.latestPublished(), undefined);
    expectThrows(() => list.publishDraft("2026-01-01", STEWARD, AT), "INVALID_STATE", "empty version");
  });

  it("normalises list and entry codes", () => {
    const list = CodeList.create(TENANT, { listCode: " Block_Reason ", name: "Block reason" });
    assert.equal(list.listCode, "block_reason");
    assert.equal(list.upsertEntry({ code: " credit ", label: "Credit" }).code, "CREDIT");
    expectThrows(() => CodeList.create(TENANT, { listCode: "1bad", name: "x" }), "VALIDATION");
    expectThrows(() => list.upsertEntry({ code: "has space", label: "x" }), "VALIDATION");
    expectThrows(() => list.upsertEntry({ code: "OK", label: "  " }), "VALIDATION", "label");
  });

  it("replaces an entry in place and keeps its sort order", () => {
    const list = flatList();
    const updated = list.upsertEntry({ code: "CREDIT", label: "Credit hold" });
    assert.equal(updated.sortOrder, 1);
    assert.equal(list.draft()?.entries.length, 2);
    assert.equal(list.draft()?.entries[0]?.label, "Credit hold");
  });

  it("refuses a second open draft and edits without one", () => {
    const list = flatList();
    list.publishDraft("2026-01-01", STEWARD, AT);
    expectThrows(() => list.upsertEntry({ code: "NEW", label: "New" }), "INVALID_STATE", "no open draft");
    list.draftNewVersion("Q2 review");
    expectThrows(() => list.draftNewVersion(), "INVALID_STATE", "already has draft");
  });

  it("seeds a new draft from the published version", () => {
    const list = flatList();
    list.publishDraft("2026-01-01", STEWARD, AT);
    const draft = list.draftNewVersion();
    assert.equal(draft.version, 2);
    assert.deepEqual(draft.entries.map((entry) => entry.code), ["CREDIT", "OVERDUE"]);
    // Editing the draft leaves the published version untouched.
    list.upsertEntry({ code: "SANCTIONS", label: "Sanctions hit" });
    assert.equal(list.versionNumbered(1).entries.length, 2);
    assert.equal(list.versionNumbered(2).entries.length, 3);
  });

  it("discards a draft but never the very first one", () => {
    const first = CodeList.create(TENANT, { listCode: "reason", name: "Reason" });
    expectThrows(() => first.discardDraft(), "INVALID_STATE", "initial draft");

    const list = flatList();
    list.publishDraft("2026-01-01", STEWARD, AT);
    list.draftNewVersion();
    list.upsertEntry({ code: "TYPO", label: "Oops" });
    list.discardDraft();
    assert.equal(list.draft(), undefined);
    assert.deepEqual(list.versions.map((version) => version.version), [1]);
  });
});

describe("effective-dated versions", () => {
  it("keeps exactly one version effective at a time", () => {
    const list = flatList();
    list.publishDraft("2026-01-01", STEWARD, AT);
    list.draftNewVersion();
    list.upsertEntry({ code: "SANCTIONS", label: "Sanctions hit", sortOrder: 3 });
    list.publishDraft("2026-06-01", STEWARD, AT);

    assert.equal(list.versionNumbered(1).effectiveTo, "2026-06-01");
    assert.equal(list.versionAt("2026-05-31")?.version, 1);
    // The successor takes over on its own first day, not the day after.
    assert.equal(list.versionAt("2026-06-01")?.version, 2);
    assert.equal(list.versionAt("2025-12-31"), undefined);
    assert.equal(list.entriesAt("2026-05-31").length, 2);
    assert.equal(list.entriesAt("2026-06-01").length, 3);
  });

  it("will not backdate a version behind its predecessor", () => {
    const list = flatList();
    list.publishDraft("2026-06-01", STEWARD, AT);
    list.draftNewVersion();
    expectThrows(() => list.publishDraft("2026-03-01", STEWARD, AT), "INVALID_STATE", "must take effect after");
  });

  it("retires a published version and leaves the list unresolvable after it", () => {
    const list = flatList();
    list.publishDraft("2026-01-01", STEWARD, AT);
    expectThrows(() => list.retireVersion(1, "2025-12-01"), "INVALID_STATE", "after");
    const retired = list.retireVersion(1, "2026-09-01");
    assert.equal(retired.status, "retired");
    assert.equal(list.versionAt("2026-08-31")?.version, 1);
    assert.equal(list.versionAt("2026-09-01"), undefined);
    expectThrows(() => list.requireUsable("CREDIT", "2026-09-02"), "CODE_LIST_ERROR", "no version effective");
    expectThrows(() => list.retireVersion(1, "2026-10-01"), "INVALID_STATE", "published");
  });

  it("resolves a code as of a date, deprecations included", () => {
    const list = flatList();
    list.publishDraft("2026-01-01", STEWARD, AT);
    list.deprecateEntry(1, "overdue", { reason: "Folded into CREDIT", replacedBy: "CREDIT" });

    assert.equal(list.lookup("OVERDUE", "2026-02-01")?.deprecated, true);
    expectThrows(() => list.requireUsable("overdue", "2026-02-01"), "CODE_LIST_ERROR", "deprecated");
    expectThrows(() => list.requireUsable("NOPE", "2026-02-01"), "CODE_LIST_ERROR", "not in block_reason");
    // Deprecated entries drop out of the browsable list but stay resolvable.
    assert.deepEqual(list.entriesAt("2026-02-01").map((e) => e.code), ["CREDIT"]);
    assert.equal(list.entriesAt("2026-02-01", { includeDeprecated: true }).length, 2);
  });

  it("accepts unknown codes only on open lists", () => {
    const open = CodeList.create(TENANT, {
      listCode: "tag",
      name: "Free-form tag",
      allowsCustomCodes: true,
    });
    open.upsertEntry({ code: "VIP", label: "VIP" });
    open.publishDraft("2026-01-01", STEWARD, AT);
    const adhoc = open.requireUsable("bespoke", "2026-02-01");
    assert.equal(adhoc.code, "BESPOKE");
    assert.equal(adhoc.deprecated, false);
  });
});

describe("deprecation and succession", () => {
  it("validates the successor before recording it", () => {
    const list = flatList();
    list.publishDraft("2026-01-01", STEWARD, AT);
    expectThrows(() => list.deprecateEntry(1, "CREDIT", { replacedBy: "GHOST" }), "CODE_LIST_ERROR", "Successor");
    list.deprecateEntry(1, "CREDIT");
    expectThrows(() => list.deprecateEntry(1, "CREDIT"), "INVALID_STATE", "already deprecated");
    expectThrows(
      () => list.deprecateEntry(1, "OVERDUE", { replacedBy: "CREDIT" }),
      "INVALID_STATE",
      "itself deprecated",
    );
    expectThrows(() => list.deprecateEntry(1, "GHOST"), "CODE_LIST_ERROR", "not in v1");
    expectThrows(() => list.versionNumbered(9), "CODE_LIST_ERROR", "no version 9");
  });

  it("follows successor chains when translating between versions", () => {
    const list = flatList();
    list.publishDraft("2026-01-01", STEWARD, AT);
    list.draftNewVersion();
    list.upsertEntry({ code: "RISK", label: "Credit risk", sortOrder: 3 });
    // CREDIT -> OVERDUE -> RISK across two hops in the new version.
    list.deprecateEntry(2, "CREDIT", { replacedBy: "OVERDUE" });
    list.deprecateEntry(2, "OVERDUE", { replacedBy: "RISK" });
    list.publishDraft("2026-06-01", STEWARD, AT);

    assert.equal(list.translate("CREDIT", 1, 2), "RISK");
    assert.equal(list.translate("RISK", 1, 2), "RISK");
    assert.equal(list.translate("UNKNOWN", 1, 2), undefined);
  });

  it("raises a deprecation event carrying the successor", () => {
    const list = flatList();
    list.publishDraft("2026-01-01", STEWARD, AT);
    list.pullEvents();
    list.deprecateEntry(1, "OVERDUE", { replacedBy: "CREDIT" });
    const [event] = list.pullEvents();
    assert.equal(event?.eventType, "mdm.code-list.entry-deprecated");
    assert.deepEqual((event?.payload as Record<string, unknown>).replacedBy, "CREDIT");
  });
});

describe("hierarchical lists", () => {
  it("walks ancestors and descendants", () => {
    const list = hierarchy();
    assert.deepEqual(
      list.ancestorsOf("MFG.AUTO.OEM", "2026-02-01").map((entry) => entry.code),
      ["MFG", "MFG.AUTO"],
    );
    assert.deepEqual(
      list.descendantsOf("MFG", "2026-02-01").map((entry) => entry.code),
      ["MFG.AUTO", "MFG.AUTO.OEM"],
    );
    assert.deepEqual(list.descendantsOf("RETAIL", "2026-02-01"), []);
  });

  it("rejects parents on flat lists, missing parents and cycles", () => {
    const flat = flatList();
    expectThrows(
      () => flat.upsertEntry({ code: "CHILD", label: "Child", parentCode: "CREDIT" }),
      "INVALID_STATE",
      "flat list",
    );

    const list = hierarchy();
    list.draftNewVersion();
    expectThrows(
      () => list.upsertEntry({ code: "X", label: "X", parentCode: "GHOST" }),
      "CODE_LIST_ERROR",
      "Parent code",
    );
    expectThrows(
      () => list.upsertEntry({ code: "MFG", label: "Manufacturing", parentCode: "MFG" }),
      "INVALID_STATE",
      "own parent",
    );
    // Re-parenting a grandparent under its own grandchild would close a loop.
    expectThrows(
      () => list.upsertEntry({ code: "MFG", label: "Manufacturing", parentCode: "MFG.AUTO.OEM" }),
      "INVALID_STATE",
      "cycle",
    );
  });

  it("keeps a draft entry that still has children", () => {
    const list = hierarchy();
    list.draftNewVersion();
    expectThrows(() => list.removeDraftEntry("MFG.AUTO"), "INVALID_STATE", "still parents");
    list.removeDraftEntry("MFG.AUTO.OEM");
    list.removeDraftEntry("MFG.AUTO");
    assert.deepEqual(
      list.draft()?.entries.map((entry) => entry.code),
      ["MFG", "RETAIL"],
    );
    expectThrows(() => list.removeDraftEntry("GHOST"), "CODE_LIST_ERROR");
  });
});

describe("version diff", () => {
  it("reports additions, relabels, deprecations and reparenting", () => {
    const list = hierarchy();
    list.draftNewVersion();
    list.upsertEntry({ code: "MFG", label: "Manufacturing and assembly", sortOrder: 1 });
    list.upsertEntry({ code: "HEALTH", label: "Healthcare", sortOrder: 5 });
    list.upsertEntry({ code: "MFG.AUTO.OEM", label: "OEM", parentCode: "MFG", sortOrder: 3 });
    list.deprecateEntry(2, "RETAIL", { reason: "Merged into services" });

    const changes = diffVersions(list.versionNumbered(1), list.versionNumbered(2));
    assert.deepEqual(changes, [
      { code: "HEALTH", change: "added", after: "Healthcare" },
      { code: "MFG", change: "relabelled", before: "Manufacturing", after: "Manufacturing and assembly" },
      { code: "MFG.AUTO.OEM", change: "reparented", before: "MFG.AUTO", after: "MFG" },
      { code: "RETAIL", change: "deprecated", after: undefined },
    ]);
  });

  it("reports removals from the draft side", () => {
    const list = hierarchy();
    list.draftNewVersion();
    list.removeDraftEntry("MFG.AUTO.OEM");
    const changes = diffVersions(list.versionNumbered(1), list.versionNumbered(2));
    assert.deepEqual(changes, [{ code: "MFG.AUTO.OEM", change: "removed", before: "OEM" }]);
  });
});

describe("code list service", () => {
  it("keeps list codes unique per tenant and isolates tenants", async () => {
    const acme = world("acme");
    const globex = world("globex");
    await acme.container.services.codeList.create(acme.ctx, { listCode: "segment", name: "Segment" });
    await expectRejects(
      acme.container.services.codeList.create(acme.ctx, { listCode: "SEGMENT", name: "Again" }),
      "CONFLICT",
    );
    await expectRejects(
      globex.container.services.codeList.get(globex.ctx, "segment"),
      "NOT_FOUND",
    );
  });

  it("publishes the aggregate's events through the outbox", async () => {
    const { container, ctx } = world();
    await container.services.codeList.create(ctx, { listCode: "segment", name: "Segment" });
    await container.services.codeList.upsertEntries(ctx, "segment", [
      { code: "KEY", label: "Key account", sortOrder: 1 },
      { code: "VOLUME", label: "Volume account", sortOrder: 2 },
    ]);
    await container.services.codeList.publish(ctx, "segment", "2026-01-01");
    await container.services.codeList.draftNewVersion(ctx, "segment", "Add long tail");
    assert.deepEqual(
      container.outbox.entries(ctx.tenantId).map((event) => event.eventType),
      [
        "mdm.code-list.created",
        "mdm.code-list.version-published",
        "mdm.code-list.version-drafted",
      ],
    );
  });

  it("resolves a code as of the clock and returns its ancestry", async () => {
    const { container, ctx, clock } = world();
    await container.services.codeList.create(ctx, {
      listCode: "industry",
      name: "Industry",
      hierarchical: true,
    });
    await container.services.codeList.upsertEntries(ctx, "industry", [
      { code: "MFG", label: "Manufacturing", sortOrder: 1 },
      { code: "MFG.AUTO", label: "Automotive", parentCode: "MFG", sortOrder: 2 },
    ]);
    await container.services.codeList.publish(ctx, "industry", "2026-01-01");

    clock.set("2026-03-01T09:00:00.000Z");
    const resolved = await container.services.codeList.resolve(ctx, "industry", "mfg.auto");
    assert.equal(resolved.version, 1);
    assert.deepEqual(resolved.path, ["MFG", "MFG.AUTO"]);
    assert.deepEqual(
      (await container.services.codeList.descendants(ctx, "industry", "MFG")).map((e) => e.code),
      ["MFG.AUTO"],
    );
    await expectRejects(
      container.services.codeList.resolve(ctx, "industry", "MFG.AUTO", "2025-06-01"),
      "CODE_LIST_ERROR",
      "no version effective",
    );
  });

  it("filters entries by parent and reports summaries", async () => {
    const { container, ctx } = world();
    await container.services.codeList.create(ctx, {
      listCode: "industry",
      name: "Industry",
      steward: "Data governance",
      hierarchical: true,
    });
    await container.services.codeList.upsertEntries(ctx, "industry", [
      { code: "MFG", label: "Manufacturing", sortOrder: 1 },
      { code: "MFG.AUTO", label: "Automotive", parentCode: "MFG", sortOrder: 2 },
      { code: "MFG.FOOD", label: "Food", parentCode: "MFG", sortOrder: 3 },
    ]);
    await container.services.codeList.publish(ctx, "industry", "2026-01-01");
    await container.services.codeList.deprecateEntry(ctx, "industry", 1, "MFG.FOOD", {
      reason: "Split out",
    });

    const children = await container.services.codeList.entries(ctx, "industry", { parentCode: "mfg" });
    assert.deepEqual(children.map((entry) => entry.code), ["MFG.AUTO"]);

    const [summary] = await container.services.codeList.list(ctx);
    assert.equal(summary?.listCode, "industry");
    assert.equal(summary?.steward, "Data governance");
    assert.equal(summary?.currentVersion, 1);
    assert.equal(summary?.currentEntryCount, 2);
    assert.equal(summary?.hasOpenDraft, false);
  });

  it("translates and diffs across versions", async () => {
    const { container, ctx } = world();
    await container.services.codeList.create(ctx, { listCode: "segment", name: "Segment" });
    await container.services.codeList.upsertEntries(ctx, "segment", [
      { code: "KEY", label: "Key account", sortOrder: 1 },
      { code: "SMB", label: "Small business", sortOrder: 2 },
    ]);
    await container.services.codeList.publish(ctx, "segment", "2026-01-01");
    await container.services.codeList.draftNewVersion(ctx, "segment");
    await container.services.codeList.upsertEntry(ctx, "segment", {
      code: "LONGTAIL",
      label: "Long tail",
      sortOrder: 3,
    });
    await container.services.codeList.deprecateEntry(ctx, "segment", 2, "SMB", {
      replacedBy: "LONGTAIL",
    });
    await container.services.codeList.publish(ctx, "segment", "2026-07-01");

    assert.deepEqual(await container.services.codeList.translate(ctx, "segment", "smb", 1, 2), {
      from: "SMB",
      to: "LONGTAIL",
      translated: true,
    });
    assert.deepEqual(await container.services.codeList.translate(ctx, "segment", "GONE", 1, 2), {
      from: "GONE",
      to: undefined,
      translated: false,
    });
    const diff = await container.services.codeList.diff(ctx, "segment", 1, 2);
    assert.deepEqual(diff.map((change) => `${change.code}:${change.change}`), [
      "LONGTAIL:added",
      "SMB:deprecated",
    ]);
  });

  it("discards a draft through the service", async () => {
    const { container, ctx } = world();
    await container.services.codeList.create(ctx, { listCode: "segment", name: "Segment" });
    await container.services.codeList.upsertEntry(ctx, "segment", { code: "KEY", label: "Key" });
    await container.services.codeList.publish(ctx, "segment", "2026-01-01");
    await container.services.codeList.draftNewVersion(ctx, "segment");
    await container.services.codeList.removeDraftEntry(ctx, "segment", "KEY");
    await container.services.codeList.discardDraft(ctx, "segment");
    const [summary] = await container.services.codeList.list(ctx);
    assert.equal(summary?.hasOpenDraft, false);
    assert.equal(summary?.versionCount, 1);
  });

  it("validates a code for other services", async () => {
    const { container, ctx } = world();
    await container.services.codeList.create(ctx, { listCode: "segment", name: "Segment" });
    await container.services.codeList.upsertEntry(ctx, "segment", { code: "KEY", label: "Key" });
    await container.services.codeList.publish(ctx, "segment", "2026-01-01");
    assert.equal((await container.services.codeList.validateCode(ctx, "segment", "key")).label, "Key");
    await expectRejects(
      container.services.codeList.validateCode(ctx, "segment", "GHOST"),
      "CODE_LIST_ERROR",
    );
  });
});
