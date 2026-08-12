# Architecture

## Style

Modular monolith / service-oriented monorepo. Each domain package owns its bounded context.

## Cross-cutting

- **Identity**: JWT-ish tenant context headers (`x-tenant-id`, `x-user-id`, `x-roles`)
- **Events**: transactional outbox pattern (in-memory outbox acceptable)
- **Money**: integer minor units + ISO currency
- **IDs**: string ULID-like prefixed ids

## Integration map (high level)

```
Marketing → Leads → Sales Quotes → Sales Orders
Product/BOM → Supply Chain MRP → Procurement POs → SRM Suppliers
Sales Orders → Inventory allocations → Logistics shipments
Manufacturing ← BOM + Work Orders ← Inventory components
Finance ← AR/AP from Sales/Procurement
PRM Partners ↔ Channel opportunities ↔ Sales deal registration
Reporting reads projections from domain events
```
