import {
  createTenantContext,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { PlmContainer } from "./container.js";

/**
 * Demo fixture: a skateboard manufacturer with a three-level BOM
 * (complete -> deck -> veneer/grip), a phantom hardware kit, variants on the
 * deck, standard costs on all purchased parts, and a pending ECO that swaps
 * the wheels. Everything goes through the application services so seeding
 * exercises the same invariants as the API.
 */

export interface SeedResult {
  readonly ctx: TenantContext;
  readonly products: Readonly<Record<string, Ulid>>;
  readonly deckAttributeSetId: Ulid;
  readonly deckVariantIds: readonly Ulid[];
  readonly pendingEcoId: Ulid;
  readonly pendingRevisionId: Ulid;
}

export async function seedDemoData(container: PlmContainer, tenant = "demo"): Promise<SeedResult> {
  const { services, clock } = container;
  const ctx = createTenantContext(tenant, "seed-bot", ["plm.admin"]);
  const now = clock.now();

  // --- units ---------------------------------------------------------------
  await services.uom.createUnit(ctx, {
    code: "ROLL25",
    name: "25 meter grip tape roll",
    dimension: "length",
    toBase: 25,
  });

  // --- categories ------------------------------------------------------------
  const boards = await services.category.create(ctx, { code: "boards", name: "Boards" });
  const decks = await services.category.create(ctx, { code: "decks", name: "Decks", parentId: boards.id });
  const completes = await services.category.create(ctx, {
    code: "completes",
    name: "Complete boards",
    parentId: boards.id,
  });
  const components = await services.category.create(ctx, { code: "components", name: "Components" });

  // --- attributes ------------------------------------------------------------
  await services.attribute.createDefinition(ctx, {
    code: "color",
    name: "Color",
    type: "select",
    options: [
      { code: "black", label: "Black" },
      { code: "red", label: "Red" },
      { code: "blue", label: "Blue" },
    ],
  });
  await services.attribute.createDefinition(ctx, {
    code: "deck_width",
    name: "Deck width (inches)",
    type: "select",
    options: [
      { code: "8_0", label: '8.0"' },
      { code: "8_25", label: '8.25"' },
      { code: "8_5", label: '8.5"' },
    ],
  });
  await services.attribute.createDefinition(ctx, {
    code: "weight_g",
    name: "Weight",
    type: "number",
    min: 0,
    max: 5000,
    uom: "G",
  });
  await services.attribute.createDefinition(ctx, {
    code: "artwork",
    name: "Artwork name",
    type: "text",
  });
  const deckSet = await services.attribute.createSet(ctx, {
    name: "Deck",
    members: [
      { code: "color", required: true, isVariantAxis: true },
      { code: "deck_width", required: true, isVariantAxis: true },
      { code: "weight_g", required: false, isVariantAxis: false },
      { code: "artwork", required: false, isVariantAxis: false },
    ],
  });

  // --- products ----------------------------------------------------------------
  const mk = async (input: Parameters<typeof services.product.create>[1]) =>
    (await services.product.create(ctx, input)).id;

  const productIds: Record<string, Ulid> = {};
  productIds["SKATE-COMP-100"] = await mk({
    code: "SKATE-COMP-100",
    name: "Complete Skateboard 100",
    type: "manufactured",
    baseUom: "EA",
    categoryId: completes.id,
  });
  productIds["DECK-MAPLE"] = await mk({
    code: "DECK-MAPLE",
    name: "7-ply Maple Deck",
    type: "manufactured",
    baseUom: "EA",
    categoryId: decks.id,
    attributeSetId: deckSet.id,
  });
  productIds["VENEER-MAPLE"] = await mk({
    code: "VENEER-MAPLE",
    name: "Maple veneer sheet",
    type: "purchased",
    baseUom: "EA",
    categoryId: components.id,
  });
  productIds["GRIP-TAPE"] = await mk({
    code: "GRIP-TAPE",
    name: "Grip tape",
    type: "purchased",
    baseUom: "M",
    categoryId: components.id,
  });
  productIds["TRUCK-539"] = await mk({
    code: "TRUCK-539",
    name: 'Truck 5.39"',
    type: "purchased",
    baseUom: "EA",
    categoryId: components.id,
  });
  productIds["WHEEL-54"] = await mk({
    code: "WHEEL-54",
    name: "Wheel 54mm 99A",
    type: "purchased",
    baseUom: "EA",
    categoryId: components.id,
  });
  productIds["WHEEL-56"] = await mk({
    code: "WHEEL-56",
    name: "Wheel 56mm 99A",
    type: "purchased",
    baseUom: "EA",
    categoryId: components.id,
  });
  productIds["BEARING-ABEC7"] = await mk({
    code: "BEARING-ABEC7",
    name: "Bearing ABEC-7",
    type: "purchased",
    baseUom: "EA",
    categoryId: components.id,
  });
  productIds["HW-KIT"] = await mk({
    code: "HW-KIT",
    name: "Mounting hardware kit",
    type: "phantom",
    baseUom: "EA",
    categoryId: components.id,
  });
  productIds["BOLT-M5"] = await mk({
    code: "BOLT-M5",
    name: "Bolt M5x30",
    type: "purchased",
    baseUom: "EA",
    categoryId: components.id,
  });
  productIds["NUT-M5"] = await mk({
    code: "NUT-M5",
    name: "Locknut M5",
    type: "purchased",
    baseUom: "EA",
    categoryId: components.id,
  });
  productIds["ASSEMBLY-LABOR"] = await mk({
    code: "ASSEMBLY-LABOR",
    name: "Assembly labor",
    type: "service",
    baseUom: "HR",
  });

  // --- standard costs (USD minor units) -------------------------------------
  const costs: Record<string, number> = {
    "VENEER-MAPLE": 350,
    "GRIP-TAPE": 200, // per meter
    "TRUCK-539": 1250,
    "WHEEL-54": 400,
    "WHEEL-56": 450,
    "BEARING-ABEC7": 150,
    "BOLT-M5": 5,
    "NUT-M5": 4,
    "ASSEMBLY-LABOR": 3000, // per hour
  };
  for (const [code, amountMinor] of Object.entries(costs)) {
    await services.product.setStandardCost(ctx, productIds[code]!, { amountMinor, currency: "USD" });
  }

  // --- deck variants ---------------------------------------------------------
  const deckId = productIds["DECK-MAPLE"]!;
  await services.product.setAttributes(ctx, deckId, {
    color: "black",
    deck_width: "8_0",
    weight_g: 1350,
  });
  const variantBlack = await services.product.addVariant(ctx, {
    productId: deckId,
    axisValues: { color: "black", deck_width: "8_0" },
  });
  const variantRed = await services.product.addVariant(ctx, {
    productId: deckId,
    axisValues: { color: "red", deck_width: "8_25" },
    attributes: { artwork: "Flame" },
  });

  // --- BOMs -------------------------------------------------------------------
  const releaseFirst = async (productId: Ulid, lines: Parameters<typeof services.bom.addLine>[3][]) => {
    const bom = await services.bom.createBom(ctx, productId);
    const draft = bom.draftRevision()!;
    for (const line of lines) await services.bom.addLine(ctx, productId, draft.id, line);
    await services.bom.releaseRevision(ctx, productId, draft.id, { effectiveFrom: now });
    return draft.id;
  };

  await releaseFirst(deckId, [
    { componentProductId: productIds["VENEER-MAPLE"]!, quantity: 7, uom: "EA", scrapFactor: 0.05 },
    { componentProductId: productIds["GRIP-TAPE"]!, quantity: 0.8, uom: "M", scrapFactor: 0.1 },
  ]);
  await releaseFirst(productIds["HW-KIT"]!, [
    { componentProductId: productIds["BOLT-M5"]!, quantity: 8, uom: "EA" },
    { componentProductId: productIds["NUT-M5"]!, quantity: 8, uom: "EA" },
  ]);
  await releaseFirst(productIds["SKATE-COMP-100"]!, [
    { componentProductId: productIds["DECK-MAPLE"]!, quantity: 1, uom: "EA" },
    { componentProductId: productIds["TRUCK-539"]!, quantity: 2, uom: "EA" },
    { componentProductId: productIds["WHEEL-54"]!, quantity: 4, uom: "EA" },
    { componentProductId: productIds["BEARING-ABEC7"]!, quantity: 8, uom: "EA" },
    { componentProductId: productIds["HW-KIT"]!, quantity: 1, uom: "EA" },
    { componentProductId: productIds["ASSEMBLY-LABOR"]!, quantity: 0.5, uom: "HR" },
  ]);

  // --- lifecycle: everything sellable goes active ----------------------------
  for (const code of Object.keys(productIds)) {
    await services.product.transitionLifecycle(ctx, productIds[code]!, "pilot");
    await services.product.transitionLifecycle(ctx, productIds[code]!, "active");
  }

  // --- pending ECO: swap 54mm wheels for 56mm --------------------------------
  const completeId = productIds["SKATE-COMP-100"]!;
  const revB = await services.bom.createDraftRevision(ctx, completeId, {
    basedOnRevisionId: (await services.bom.getByProduct(ctx, completeId)).releasedRevisions()[0]!.id,
    notes: "Swap to 56mm wheels",
  });
  const wheelLine = revB.lines.find((l) => l.componentProductId === productIds["WHEEL-54"])!;
  await services.bom.removeLine(ctx, completeId, revB.id, wheelLine.id);
  await services.bom.addLine(ctx, completeId, revB.id, {
    componentProductId: productIds["WHEEL-56"]!,
    quantity: 4,
    uom: "EA",
  });
  const eco = await services.eco.create(ctx, {
    title: "Switch completes to 56mm wheels",
    description: "Larger wheels roll over rough ground better; supplier price +$0.50.",
    reason: "customer_request",
    priority: "medium",
  });
  const in30Days = new Date(Date.parse(now) + 30 * 24 * 3600 * 1000).toISOString() as IsoDateTime;
  await services.eco.addItem(ctx, eco.id, {
    productId: completeId,
    change: { kind: "bom_release", bomRevisionId: revB.id, effectiveFrom: in30Days },
    description: "Release revision B of the complete's BOM",
  });
  await services.eco.submit(ctx, eco.id);

  return {
    ctx,
    products: productIds,
    deckAttributeSetId: deckSet.id,
    deckVariantIds: [variantBlack.id, variantRed.id],
    pendingEcoId: eco.id,
    pendingRevisionId: revB.id,
  };
}
