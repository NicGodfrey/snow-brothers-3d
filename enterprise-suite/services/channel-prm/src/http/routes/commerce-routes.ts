import type { Money, Ulid } from "@enterprise-suite/shared-kernel";
import { orderView, pageView, quoteView } from "../../application/dto.js";
import { CHANNEL_ORDER_STATUSES, ORDER_SOURCE_TYPES, type ChannelOrderStatus, type OrderSourceType } from "../../domain/channel-order.js";
import { CHANNEL_QUOTE_STATUSES, type AddQuoteLineInput, type ChannelQuoteStatus } from "../../domain/channel-quote.js";
import { ValidationError } from "../../domain/errors.js";
import type { ChannelContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  enumFromQuery,
  isoFromQuery,
  optionalExternalRef,
  optionalId,
  optionalMoney,
  optionalNumber,
  optionalString,
  pageFromQuery,
  requiredEnum,
  requiredId,
  requiredMoney,
  requiredNumber,
  requiredString,
} from "../validate.js";

function parseLine(raw: unknown): AddQuoteLineInput {
  const body = asRecord(raw);
  return {
    productLine: requiredString(body, "productLine"),
    sku: optionalString(body, "sku"),
    description: optionalString(body, "description"),
    quantity: requiredNumber(body, "quantity"),
    listUnitPrice: requiredMoney(body, "listUnitPrice"),
    requestedUnitPrice: optionalMoney(body, "requestedUnitPrice"),
  };
}

function parseUnitPrices(raw: unknown): ReadonlyMap<Ulid, Money> | undefined {
  if (raw === undefined || raw === null) return undefined;
  const body = asRecord(raw);
  const entries = new Map<Ulid, Money>();
  for (const key of Object.keys(body)) {
    entries.set(key as Ulid, requiredMoney(body, key));
  }
  return entries;
}

export function registerCommerceRoutes(router: Router, container: ChannelContainer): void {
  const { services, clock } = container;

  // --- channel quotes ------------------------------------------------------

  router.post("/channel-quotes", async (req) => {
    const body = asRecord(req.body);
    const rawLines = body["lines"];
    if (rawLines !== undefined && !Array.isArray(rawLines)) {
      throw ValidationError.single("lines", "must be an array of line objects");
    }
    const quote = await services.quote.create(req.ctx, {
      partnerId: requiredId(body, "partnerId"),
      registrationId: optionalId(body, "registrationId"),
      customerKey: optionalString(body, "customerKey"),
      customerName: optionalString(body, "customerName"),
      notes: optionalString(body, "notes"),
      salesQuoteRef: optionalExternalRef(body, "salesQuoteRef"),
      lines: (rawLines as unknown[] | undefined)?.map(parseLine),
    });
    return jsonResponse(201, quoteView(quote, clock.now()));
  });

  router.get("/channel-quotes", async (req) => {
    const page = await services.quote.list(
      req.ctx,
      {
        status: enumFromQuery<ChannelQuoteStatus>(req.query, "status", CHANNEL_QUOTE_STATUSES),
        partnerId: (req.query.get("partnerId") as Ulid | null) ?? undefined,
        registrationId: (req.query.get("registrationId") as Ulid | null) ?? undefined,
        customerKey: req.query.get("customerKey") ?? undefined,
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, pageView(page, (quote) => quoteView(quote, clock.now())));
  });

  router.get("/channel-quotes/:id", async (req) =>
    jsonResponse(200, quoteView(await services.quote.get(req.ctx, req.params["id"] as Ulid), clock.now())),
  );

  router.post("/channel-quotes/:id/lines", async (req) => {
    const line = await services.quote.addLine(req.ctx, req.params["id"] as Ulid, parseLine(req.body));
    return jsonResponse(201, line);
  });

  router.patch("/channel-quotes/:id/lines/:lineId", async (req) => {
    const body = asRecord(req.body);
    const line = await services.quote.updateLine(req.ctx, req.params["id"] as Ulid, req.params["lineId"] as Ulid, {
      quantity: optionalNumber(body, "quantity"),
      requestedUnitPrice: optionalMoney(body, "requestedUnitPrice"),
      description: optionalString(body, "description"),
    });
    return jsonResponse(200, line);
  });

  router.delete("/channel-quotes/:id/lines/:lineId", async (req) => {
    await services.quote.removeLine(req.ctx, req.params["id"] as Ulid, req.params["lineId"] as Ulid);
    return jsonResponse(204);
  });

  router.post("/channel-quotes/:id/submit", async (req) => {
    const body = asRecord(req.body ?? {});
    const result = await services.quote.submit(req.ctx, req.params["id"] as Ulid, {
      validityDays: optionalNumber(body, "validityDays"),
    });
    return jsonResponse(200, {
      quote: quoteView(result.quote, clock.now()),
      authority: result.authority,
      autoApproved: result.autoApproved,
    });
  });

  router.post("/channel-quotes/:id/approve", async (req) => {
    const body = asRecord(req.body ?? {});
    const quote = await services.quote.approve(req.ctx, req.params["id"] as Ulid, {
      discountBps: optionalNumber(body, "discountBps"),
      unitPrices: parseUnitPrices(body["unitPrices"]),
      notes: optionalString(body, "notes"),
      salesQuoteRef: optionalExternalRef(body, "salesQuoteRef"),
    });
    return jsonResponse(200, quoteView(quote, clock.now()));
  });

  router.post("/channel-quotes/:id/reject", async (req) => {
    const body = asRecord(req.body);
    const quote = await services.quote.reject(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, quoteView(quote, clock.now()));
  });

  router.post("/channel-quotes/:id/revise", async (req) =>
    jsonResponse(201, quoteView(await services.quote.revise(req.ctx, req.params["id"] as Ulid), clock.now())),
  );

  // --- channel orders ------------------------------------------------------

  router.post("/channel-orders", async (req) => {
    const body = asRecord(req.body);
    const salesOrderRef = optionalExternalRef(body, "salesOrderRef");
    if (!salesOrderRef) throw ValidationError.single("salesOrderRef", "a sales order reference is required");
    const order = await services.order.place(req.ctx, {
      partnerId: requiredId(body, "partnerId"),
      channelQuoteId: optionalId(body, "channelQuoteId"),
      registrationId: optionalId(body, "registrationId"),
      salesOrderRef,
      netValue: optionalMoney(body, "netValue"),
      listValue: optionalMoney(body, "listValue"),
      sourceType:
        body["sourceType"] !== undefined
          ? requiredEnum<OrderSourceType>(body, "sourceType", ORDER_SOURCE_TYPES)
          : undefined,
      customerKey: optionalString(body, "customerKey"),
      customerName: optionalString(body, "customerName"),
      poNumber: optionalString(body, "poNumber"),
      closeRegistration: body["closeRegistration"] === undefined ? undefined : body["closeRegistration"] === true,
    });
    return jsonResponse(201, orderView(order));
  });

  router.get("/channel-orders", async (req) => {
    const page = await services.order.list(
      req.ctx,
      {
        status: enumFromQuery<ChannelOrderStatus>(req.query, "status", CHANNEL_ORDER_STATUSES),
        partnerId: (req.query.get("partnerId") as Ulid | null) ?? undefined,
        registrationId: (req.query.get("registrationId") as Ulid | null) ?? undefined,
        sourceType: enumFromQuery<OrderSourceType>(req.query, "sourceType", ORDER_SOURCE_TYPES),
        from: isoFromQuery(req.query, "from"),
        to: isoFromQuery(req.query, "to"),
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, pageView(page, orderView));
  });

  router.get("/channel-orders/:id", async (req) =>
    jsonResponse(200, orderView(await services.order.get(req.ctx, req.params["id"] as Ulid))),
  );

  router.post("/channel-orders/:id/invoice", async (req) => {
    const body = asRecord(req.body ?? {});
    const order = await services.order.invoice(req.ctx, req.params["id"] as Ulid, optionalExternalRef(body, "invoiceRef"));
    return jsonResponse(200, orderView(order));
  });

  router.post("/channel-orders/:id/fulfill", async (req) =>
    jsonResponse(200, orderView(await services.order.fulfill(req.ctx, req.params["id"] as Ulid))),
  );

  router.post("/channel-orders/:id/cancel", async (req) => {
    const body = asRecord(req.body);
    const order = await services.order.cancel(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, orderView(order));
  });

  router.get("/partners/:id/attainment", async (req) => {
    const partner = await services.partner.resolve(req.ctx, req.params["id"]!);
    const to = isoFromQuery(req.query, "to") ?? clock.now();
    const from = isoFromQuery(req.query, "from") ?? (new Date(Date.parse(to) - 365 * 86_400_000).toISOString() as never);
    return jsonResponse(200, await services.order.attainment(req.ctx, partner.id, { from, to }));
  });
}
