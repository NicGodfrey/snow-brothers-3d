import type { TenantId } from "../kernel/index.js";

export type DocumentKind = "account" | "quote" | "order" | "rma";

const PREFIXES: Record<DocumentKind, string> = {
  account: "ACC",
  quote: "Q",
  order: "SO",
  rma: "RMA",
};

export interface NumberSequencePort {
  /** Returns the next integer in the per-tenant, per-kind sequence (starting at 1). */
  next(tenantId: TenantId, kind: DocumentKind): number;
}

export function formatDocumentNumber(kind: DocumentKind, seq: number): string {
  return `${PREFIXES[kind]}-${String(seq).padStart(5, "0")}`;
}

export class DocumentNumberGenerator {
  constructor(private readonly sequences: NumberSequencePort) {}

  nextNumber(tenantId: TenantId, kind: DocumentKind): string {
    return formatDocumentNumber(kind, this.sequences.next(tenantId, kind));
  }
}
