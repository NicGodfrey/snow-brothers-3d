-- Procurement SRM: document numbering, the integration outbox and the read
-- views buyers and BI share.

-- Human-readable document numbers (PR-2026-000042) are part of the public
-- contract: suppliers quote them on packing slips and invoices. The counter is
-- per tenant, series and year, and is allocated inside the transaction that
-- writes the document so numbering has no gaps.
CREATE TABLE proc_document_sequences (
    tenant_id     TEXT     NOT NULL,
    series        TEXT     NOT NULL CHECK (series IN ('PR', 'RFQ', 'QT', 'PO', 'GRN', 'INV', 'BPA')),
    year          SMALLINT NOT NULL CHECK (year BETWEEN 2000 AND 2999),
    last_sequence INTEGER  NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
    PRIMARY KEY (tenant_id, series, year)
);

-- Transactional outbox. Aggregates raise events; they are written here in the
-- same transaction as the state change and drained by integration-hub, so a
-- crash between "state changed" and "event published" cannot happen.
CREATE TABLE proc_outbox (
    id             TEXT        PRIMARY KEY,
    tenant_id      TEXT        NOT NULL,
    event_type     TEXT        NOT NULL CHECK (event_type ~ '^procurement\.[a-z_]+\.[a-z_]+$'),
    aggregate_type TEXT        NOT NULL,
    aggregate_id   TEXT        NOT NULL,
    payload        JSONB       NOT NULL,
    occurred_at    TIMESTAMPTZ NOT NULL,
    published_at   TIMESTAMPTZ,
    attempts       SMALLINT    NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error     TEXT
);
CREATE INDEX proc_outbox_unpublished_idx
    ON proc_outbox (tenant_id, occurred_at) WHERE published_at IS NULL;
CREATE INDEX proc_outbox_aggregate_idx ON proc_outbox (tenant_id, aggregate_id, occurred_at);

-- Approved demand with quantity still uncovered: the buyer's sourcing
-- worklist, and the same definition the service exposes as /requisitions/sourceable.
CREATE VIEW proc_v_open_demand AS
SELECT l.tenant_id,
       r.id                              AS requisition_id,
       r.requisition_number,
       r.cost_center,
       r.priority,
       l.id                              AS line_id,
       l.line_number,
       l.description,
       l.category_code,
       l.quantity - l.ordered_quantity   AS open_quantity,
       l.uom,
       l.estimated_price_minor,
       round(l.estimated_price_minor * (l.quantity - l.ordered_quantity)) AS open_value_minor,
       r.currency,
       coalesce(l.needed_by, r.needed_by) AS needed_by
FROM proc_requisition_lines l
JOIN proc_requisitions r ON r.id = l.requisition_id
WHERE r.status IN ('approved', 'partially_ordered')
  AND l.status IN ('open', 'sourcing', 'partially_ordered')
  AND l.quantity > l.ordered_quantity;

-- Open commitment: ordered value the supplier has not yet delivered. Cancelled
-- lines and cancelled orders contribute nothing.
CREATE VIEW proc_v_open_commitment AS
SELECT o.tenant_id,
       o.supplier_id,
       o.currency,
       count(DISTINCT o.id)                                          AS order_count,
       coalesce(sum(round(
           l.unit_price_minor * (1 - l.discount_bps / 10000.0)
           * (l.quantity - l.received_quantity)
       )), 0)                                                        AS outstanding_minor
FROM proc_purchase_orders o
JOIN proc_purchase_order_lines l ON l.purchase_order_id = o.id
WHERE o.status IN ('issued', 'acknowledged', 'partially_received')
  AND l.status IN ('open', 'partially_received')
  AND l.quantity > l.received_quantity
GROUP BY o.tenant_id, o.supplier_id, o.currency;

-- Goods received, not invoiced: the accrual finance needs at period end.
-- Driven off accepted (not received) quantity, because rejected goods are
-- never payable.
CREATE VIEW proc_v_gr_ir AS
SELECT o.tenant_id,
       o.currency,
       o.id           AS purchase_order_id,
       o.order_number,
       o.supplier_id,
       coalesce(sum(round(
           l.unit_price_minor * (1 - l.discount_bps / 10000.0)
           * (l.accepted_quantity - l.invoiced_quantity)
       )), 0) AS accrual_minor
FROM proc_purchase_orders o
JOIN proc_purchase_order_lines l ON l.purchase_order_id = o.id
WHERE l.accepted_quantity > l.invoiced_quantity
GROUP BY o.tenant_id, o.currency, o.id, o.order_number, o.supplier_id;

-- Spend by supplier and category, from ordered value rather than invoices, so
-- a category manager sees commitments as they are made.
CREATE VIEW proc_v_spend AS
SELECT o.tenant_id,
       o.supplier_id,
       l.category_code,
       o.currency,
       date_trunc('month', o.order_date)                                    AS period,
       count(DISTINCT o.id)                                                 AS order_count,
       coalesce(sum(round(l.unit_price_minor * (1 - l.discount_bps / 10000.0) * l.quantity)), 0) AS ordered_minor,
       coalesce(sum(round(l.unit_price_minor * (1 - l.discount_bps / 10000.0) * l.accepted_quantity)), 0) AS received_minor,
       coalesce(sum(l.invoiced_amount_minor), 0)                            AS invoiced_minor,
       coalesce(sum(round(l.unit_price_minor * (1 - l.discount_bps / 10000.0) * l.quantity))
                FILTER (WHERE o.agreement_id IS NOT NULL), 0)               AS on_contract_minor
FROM proc_purchase_orders o
JOIN proc_purchase_order_lines l ON l.purchase_order_id = o.id
WHERE o.status <> 'draft'
  AND o.status <> 'cancelled'
  AND l.status <> 'cancelled'
GROUP BY o.tenant_id, o.supplier_id, l.category_code, o.currency, date_trunc('month', o.order_date);

-- On-time delivery, one row per receipted order line. The promised date wins
-- over the requested one: a supplier is measured against what it committed to.
CREATE VIEW proc_v_delivery_performance AS
SELECT g.tenant_id,
       g.supplier_id,
       g.id                        AS receipt_id,
       g.receipt_date,
       l.purchase_order_line_number,
       coalesce(ol.promised_date, ol.need_by) AS due_date,
       (g.receipt_date <= coalesce(ol.promised_date, ol.need_by)) AS on_time,
       l.received_quantity,
       l.rejected_quantity
FROM proc_goods_receipts g
JOIN proc_goods_receipt_lines l ON l.receipt_id = g.id
JOIN proc_purchase_order_lines ol
  ON ol.purchase_order_id = g.purchase_order_id
 AND ol.line_number = l.purchase_order_line_number
WHERE g.status = 'posted';

-- The AP work queue: invoices blocked on a match exception, worst first.
CREATE VIEW proc_v_invoice_exceptions AS
SELECT i.tenant_id,
       i.id            AS invoice_id,
       i.invoice_number,
       i.supplier_invoice_number,
       i.supplier_id,
       i.purchase_order_id,
       i.currency,
       i.declared_total_minor,
       i.due_date,
       count(*) FILTER (WHERE e.severity = 'blocking') AS blocking_count,
       count(*) FILTER (WHERE e.severity = 'warning')  AS warning_count,
       array_agg(DISTINCT e.code)                      AS codes
FROM proc_supplier_invoices i
JOIN proc_match_exceptions e ON e.invoice_id = i.id AND e.resolved = FALSE
WHERE i.status IN ('exception', 'on_hold')
GROUP BY i.tenant_id, i.id, i.invoice_number, i.supplier_invoice_number, i.supplier_id,
         i.purchase_order_id, i.currency, i.declared_total_minor, i.due_date;

-- Contract drawdown: how much of each agreement is spent, and how long is left
-- to spend the rest.
CREATE VIEW proc_v_agreement_utilisation AS
SELECT a.tenant_id,
       a.id AS agreement_id,
       a.agreement_number,
       a.supplier_id,
       a.currency,
       a.status,
       a.effective_to,
       a.maximum_value_minor,
       a.released_value_minor,
       a.maximum_value_minor - a.released_value_minor AS remaining_minor,
       a.minimum_commitment_minor,
       CASE
           WHEN a.minimum_commitment_minor IS NULL OR a.minimum_commitment_minor = 0 THEN NULL
           ELSE round(a.released_value_minor * 10000.0 / a.minimum_commitment_minor)
       END AS commitment_progress_bps,
       (a.effective_to - CURRENT_DATE) AS days_to_expiry
FROM proc_agreements a;
