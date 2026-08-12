import {
  AggregateRoot,
  ConflictError,
  envelope,
  newId,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { InvalidStateError, ValidationError } from "./errors.js";
import { PlmEventTypes } from "./events.js";
import type { UomCode } from "./uom.js";

/**
 * Bill of materials.
 *
 * One BOM aggregate per product. The BOM owns an ordered history of
 * *revisions*; each revision is a complete parts list with a date effectivity
 * window. Invariants:
 *
 * - At most one draft revision at a time. Drafts are the only editable state.
 * - Released revisions are immutable. Changing a released BOM means cutting a
 *   new draft (usually via ECO) and releasing it.
 * - Released effectivity windows never overlap. Releasing revision N with an
 *   open-ended predecessor auto-truncates the predecessor's `effectiveTo` to
 *   the new `effectiveFrom` (supersession). A predecessor with an explicit
 *   window that would overlap is a conflict, never silently rewritten.
 * - Once a first revision is released, further releases require an ECO
 *   reference (enforced by BomService, which can verify ECO state).
 */

export type BomRevisionStatus = "draft" | "released" | "obsolete";

export interface BomLine {
  readonly id: Ulid;
  readonly componentProductId: Ulid;
  /** Pin the line to a specific variant of the component, if needed. */
  readonly componentVariantId?: Ulid;
  /** Quantity of the component needed per 1 base unit of the parent. */
  readonly quantity: number;
  readonly uom: UomCode;
  /** Expected scrap as a fraction, e.g. 0.05 = 5% extra consumed. */
  readonly scrapFactor: number;
  /** E.g. PCB reference designators: ["R1", "R2"]. */
  readonly referenceDesignators: readonly string[];
  /** Sort/position number; auto-assigned in steps of 10. */
  readonly position: number;
  readonly notes?: string;
}

export interface BomRevision {
  readonly id: Ulid;
  /** "A", "B", ... "Z", "AA", ... */
  readonly code: string;
  status: BomRevisionStatus;
  effectiveFrom?: IsoDateTime;
  effectiveTo?: IsoDateTime;
  notes?: string;
  /** ECO that authorized this revision's release, when applicable. */
  ecoId?: Ulid;
  releasedAt?: IsoDateTime;
  releasedBy?: UserId;
  lines: BomLine[];
}

export interface BomProps {
  productId: Ulid;
  revisions: BomRevision[];
}

export interface BomLineInput {
  readonly componentProductId: Ulid;
  readonly componentVariantId?: Ulid;
  readonly quantity: number;
  readonly uom: UomCode;
  readonly scrapFactor?: number;
  readonly referenceDesignators?: readonly string[];
  readonly notes?: string;
}

export function nextRevisionCode(existing: readonly string[]): string {
  // Base-26 alpha sequence: A..Z, AA, AB, ...
  const toNumber = (code: string): number =>
    [...code].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
  const toCode = (n: number): string => {
    let out = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  };
  const max = existing.reduce((acc, code) => Math.max(acc, toNumber(code)), 0);
  return toCode(max + 1);
}

const MAX_SCRAP = 0.9;

function validateLineInput(input: BomLineInput, ownProductId: Ulid): void {
  if (input.componentProductId === ownProductId) {
    throw ValidationError.single("componentProductId", "a BOM cannot reference its own product");
  }
  if (!(input.quantity > 0) || !Number.isFinite(input.quantity)) {
    throw ValidationError.single("quantity", "quantity must be a positive number");
  }
  const scrap = input.scrapFactor ?? 0;
  if (scrap < 0 || scrap >= MAX_SCRAP) {
    throw ValidationError.single("scrapFactor", `scrap factor must be in [0, ${MAX_SCRAP})`);
  }
}

export class Bom extends AggregateRoot<BomProps> {
  static create(tenantId: TenantId, productId: Ulid): Bom {
    const bom = new Bom(tenantId, { productId, revisions: [] });
    bom.raise(
      envelope({
        eventType: PlmEventTypes.BomCreated,
        aggregateType: "Bom",
        aggregateId: bom.id,
        tenantId,
        payload: { bomId: bom.id, productId },
      }),
    );
    return bom;
  }

  static fromSnapshot(snapshot: EntityProps & BomProps): Bom {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Bom(
      tenantId,
      {
        productId: props.productId,
        revisions: props.revisions.map((r) => ({ ...r, lines: [...r.lines] })),
      },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -----------------------------------------------------------

  get productId(): Ulid {
    return this.props.productId;
  }

  get revisions(): readonly BomRevision[] {
    return this.props.revisions;
  }

  revisionById(revisionId: Ulid): BomRevision | undefined {
    return this.props.revisions.find((r) => r.id === revisionId);
  }

  draftRevision(): BomRevision | undefined {
    return this.props.revisions.find((r) => r.status === "draft");
  }

  releasedRevisions(): readonly BomRevision[] {
    return this.props.revisions.filter((r) => r.status === "released");
  }

  hasEverBeenReleased(): boolean {
    return this.props.revisions.some((r) => r.status === "released" || r.status === "obsolete");
  }

  /** The revision in effect at `at`, or undefined outside all windows. */
  effectiveRevision(at: IsoDateTime): BomRevision | undefined {
    const t = Date.parse(at);
    return this.releasedRevisions().find((r) => {
      const from = r.effectiveFrom ? Date.parse(r.effectiveFrom) : Number.POSITIVE_INFINITY;
      const to = r.effectiveTo ? Date.parse(r.effectiveTo) : Number.POSITIVE_INFINITY;
      return from <= t && t < to;
    });
  }

  // --- commands ------------------------------------------------------------

  /** Cuts a new draft, optionally copying lines from an existing revision. */
  createDraftRevision(input: { readonly basedOnRevisionId?: Ulid; readonly notes?: string } = {}): BomRevision {
    if (this.draftRevision()) {
      throw new ConflictError(
        `BOM for product ${this.props.productId} already has a draft revision (${this.draftRevision()!.code})`,
      );
    }
    let lines: BomLine[] = [];
    if (input.basedOnRevisionId) {
      const base = this.revisionById(input.basedOnRevisionId);
      if (!base) {
        throw new InvalidStateError(`Base revision ${input.basedOnRevisionId} not found`);
      }
      lines = base.lines.map((l) => ({ ...l, id: newId("bomline") }));
    }
    const revision: BomRevision = {
      id: newId("bomrev"),
      code: nextRevisionCode(this.props.revisions.map((r) => r.code)),
      status: "draft",
      notes: input.notes,
      lines,
    };
    this.props.revisions.push(revision);
    this.raise(
      envelope({
        eventType: PlmEventTypes.BomRevisionCreated,
        aggregateType: "Bom",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          bomId: this.id,
          productId: this.props.productId,
          revisionId: revision.id,
          revisionCode: revision.code,
          basedOnRevisionId: input.basedOnRevisionId,
        },
      }),
    );
    return revision;
  }

  addLine(revisionId: Ulid, input: BomLineInput): BomLine {
    const revision = this.editableRevision(revisionId);
    validateLineInput(input, this.props.productId);
    const duplicate = revision.lines.find(
      (l) =>
        l.componentProductId === input.componentProductId &&
        (l.componentVariantId ?? null) === (input.componentVariantId ?? null),
    );
    if (duplicate) {
      throw new ConflictError(
        `Component ${input.componentProductId} is already on revision ${revision.code}; update the existing line instead`,
      );
    }
    const line: BomLine = {
      id: newId("bomline"),
      componentProductId: input.componentProductId,
      componentVariantId: input.componentVariantId,
      quantity: input.quantity,
      uom: input.uom,
      scrapFactor: input.scrapFactor ?? 0,
      referenceDesignators: [...(input.referenceDesignators ?? [])],
      position: revision.lines.reduce((max, l) => Math.max(max, l.position), 0) + 10,
      notes: input.notes,
    };
    revision.lines.push(line);
    this.touch();
    return line;
  }

  updateLine(
    revisionId: Ulid,
    lineId: Ulid,
    patch: Partial<Pick<BomLine, "quantity" | "uom" | "scrapFactor" | "referenceDesignators" | "notes">>,
  ): BomLine {
    const revision = this.editableRevision(revisionId);
    const index = revision.lines.findIndex((l) => l.id === lineId);
    if (index === -1) {
      throw new InvalidStateError(`Line ${lineId} not found on revision ${revision.code}`);
    }
    const updated: BomLine = { ...revision.lines[index]!, ...patch };
    validateLineInput(updated, this.props.productId);
    revision.lines[index] = updated;
    this.touch();
    return updated;
  }

  removeLine(revisionId: Ulid, lineId: Ulid): void {
    const revision = this.editableRevision(revisionId);
    const index = revision.lines.findIndex((l) => l.id === lineId);
    if (index === -1) {
      throw new InvalidStateError(`Line ${lineId} not found on revision ${revision.code}`);
    }
    revision.lines.splice(index, 1);
    this.touch();
  }

  /**
   * Releases a draft. Enforces effectivity invariants and supersedes the
   * open-ended predecessor, if any. ECO gating is the caller's job (needs the
   * ECO aggregate); the authorizing `ecoId` is stamped here for traceability.
   */
  release(
    revisionId: Ulid,
    input: {
      readonly effectiveFrom: IsoDateTime;
      readonly effectiveTo?: IsoDateTime;
      readonly releasedBy: UserId;
      readonly at: IsoDateTime;
      readonly ecoId?: Ulid;
    },
  ): BomRevision {
    const revision = this.revisionById(revisionId);
    if (!revision) throw new InvalidStateError(`Revision ${revisionId} not found`);
    if (revision.status !== "draft") {
      throw new InvalidStateError(`Revision ${revision.code} is ${revision.status}; only drafts can be released`);
    }
    if (revision.lines.length === 0) {
      throw new InvalidStateError(`Revision ${revision.code} has no lines`);
    }
    const from = Date.parse(input.effectiveFrom);
    if (Number.isNaN(from)) {
      throw ValidationError.single("effectiveFrom", "invalid date");
    }
    if (input.effectiveTo !== undefined && Date.parse(input.effectiveTo) <= from) {
      throw ValidationError.single("effectiveTo", "must be after effectiveFrom");
    }

    for (const other of this.releasedRevisions()) {
      const otherFrom = Date.parse(other.effectiveFrom!);
      if (otherFrom >= from) {
        throw new ConflictError(
          `Revision ${other.code} is already effective from ${other.effectiveFrom}; new releases must start later`,
        );
      }
      if (other.effectiveTo === undefined) {
        // Open-ended predecessor: supersede by truncating its window.
        other.effectiveTo = input.effectiveFrom;
      } else if (Date.parse(other.effectiveTo) > from) {
        throw new ConflictError(
          `Effectivity overlaps revision ${other.code} (${other.effectiveFrom} .. ${other.effectiveTo})`,
        );
      }
    }

    revision.status = "released";
    revision.effectiveFrom = input.effectiveFrom;
    revision.effectiveTo = input.effectiveTo;
    revision.releasedAt = input.at;
    revision.releasedBy = input.releasedBy;
    revision.ecoId = input.ecoId;
    this.raise(
      envelope({
        eventType: PlmEventTypes.BomRevisionReleased,
        aggregateType: "Bom",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          bomId: this.id,
          productId: this.props.productId,
          revisionId: revision.id,
          revisionCode: revision.code,
          effectiveFrom: revision.effectiveFrom,
          effectiveTo: revision.effectiveTo,
          ecoId: revision.ecoId,
          lineCount: revision.lines.length,
        },
      }),
    );
    return revision;
  }

  /** Marks a released revision obsolete, closing its window if still open. */
  obsoleteRevision(revisionId: Ulid, at: IsoDateTime): BomRevision {
    const revision = this.revisionById(revisionId);
    if (!revision) throw new InvalidStateError(`Revision ${revisionId} not found`);
    if (revision.status !== "released") {
      throw new InvalidStateError(`Only released revisions can be obsoleted; ${revision.code} is ${revision.status}`);
    }
    revision.status = "obsolete";
    if (revision.effectiveTo === undefined || Date.parse(revision.effectiveTo) > Date.parse(at)) {
      revision.effectiveTo = at;
    }
    this.raise(
      envelope({
        eventType: PlmEventTypes.BomRevisionObsoleted,
        aggregateType: "Bom",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          bomId: this.id,
          productId: this.props.productId,
          revisionId: revision.id,
          revisionCode: revision.code,
        },
      }),
    );
    return revision;
  }

  private editableRevision(revisionId: Ulid): BomRevision {
    const revision = this.revisionById(revisionId);
    if (!revision) throw new InvalidStateError(`Revision ${revisionId} not found`);
    if (revision.status !== "draft") {
      throw new InvalidStateError(
        `Revision ${revision.code} is ${revision.status} and immutable; cut a new draft to change it`,
      );
    }
    return revision;
  }
}
