/**
 * CAPA (Corrective / Preventive Action) aggregate.
 *
 * A CAPA case drives systematic problem solving beyond the immediate
 * disposition of an NCR: root cause analysis, planned actions, verified
 * implementation, and an effectiveness check before closure.
 *
 * Workflow:
 *   draft -> open -> investigation -> action-planning -> implementation
 *         -> verification -> closed
 *   verification -> action-planning   (effectiveness check failed)
 *   any non-terminal -> cancelled
 *
 * Guards (the heart of the model):
 *  - investigation -> action-planning requires a recorded root cause analysis
 *  - action-planning -> implementation requires >= 1 corrective/preventive action
 *  - implementation -> verification requires every action completed or cancelled
 *  - verification -> closed requires an "effective" effectiveness check
 */
import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  newId,
  nowIso,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { QualityEventTypes, type CapaStateChangedPayload } from "./events.js";
import { StateMachine } from "./state-machine.js";

export type CapaStatus =
  | "draft"
  | "open"
  | "investigation"
  | "action-planning"
  | "implementation"
  | "verification"
  | "closed"
  | "cancelled";

export type CapaType = "corrective" | "preventive";
export type CapaPriority = "low" | "medium" | "high" | "urgent";
export type RootCauseMethod = "5-whys" | "fishbone" | "8d" | "fault-tree" | "other";
export type CapaActionType = "containment" | "corrective" | "preventive";
export type CapaActionStatus = "open" | "in-progress" | "completed" | "cancelled";

export interface RiskRating {
  /** 1 (negligible) .. 5 (catastrophic) */
  readonly severity: number;
  /** 1 (rare) .. 5 (frequent) */
  readonly occurrence: number;
  /** 1 (certain detection) .. 5 (undetectable) */
  readonly detection: number;
  /** Risk priority number = severity * occurrence * detection (1..125). */
  readonly rpn: number;
}

export interface RootCauseAnalysis {
  readonly method: RootCauseMethod;
  readonly summary: string;
  readonly causes: readonly { readonly category?: string; readonly description: string }[];
  readonly completedBy: UserId;
  readonly completedAt: IsoDateTime;
}

export interface CapaAction {
  readonly id: Ulid;
  readonly type: CapaActionType;
  readonly description: string;
  readonly owner: UserId;
  readonly dueAt: IsoDateTime;
  readonly status: CapaActionStatus;
  readonly completedAt?: IsoDateTime;
  readonly completionNote?: string;
}

export interface EffectivenessCheck {
  readonly criteria: string;
  readonly dueAt: IsoDateTime;
  readonly outcome?: "effective" | "not-effective";
  readonly verifiedBy?: UserId;
  readonly verifiedAt?: IsoDateTime;
  readonly note?: string;
}

export interface CapaSourceLinkage {
  readonly ncrIds: Ulid[];
  readonly auditId?: Ulid;
  readonly supplierEventId?: Ulid;
  readonly supplierId?: string;
  readonly customerRef?: string;
}

interface CapaProps {
  capaNumber: string;
  type: CapaType;
  title: string;
  description: string;
  priority: CapaPriority;
  status: CapaStatus;
  riskRating?: RiskRating;
  source: CapaSourceLinkage;
  rootCause?: RootCauseAnalysis;
  actions: CapaAction[];
  effectiveness?: EffectivenessCheck;
  owner: UserId;
  closure?: { closedBy: UserId; closedAt: IsoDateTime; note?: string };
  cancellation?: { cancelledBy: UserId; cancelledAt: IsoDateTime; reason: string };
  /** Count of verification failures that sent the case back to planning. */
  reworkCycles: number;
}

export function riskRating(severity: number, occurrence: number, detection: number): RiskRating {
  for (const [label, v] of [["severity", severity], ["occurrence", occurrence], ["detection", detection]] as const) {
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      throw new DomainError(`risk ${label} must be an integer 1..5, got ${v}`, "VALIDATION");
    }
  }
  return { severity, occurrence, detection, rpn: severity * occurrence * detection };
}

const capaMachine = new StateMachine<CapaStatus, CapaCase>(
  "CAPA",
  [
    { from: "draft", to: "open" },
    { from: "open", to: "investigation" },
    {
      from: "investigation",
      to: "action-planning",
      guard: (capa) =>
        capa.rootCause ? undefined : "root cause analysis must be recorded first",
    },
    {
      from: "action-planning",
      to: "implementation",
      guard: (capa) => {
        const effective = capa.actions.filter(
          (a) => a.status !== "cancelled" && (a.type === "corrective" || a.type === "preventive"),
        );
        return effective.length === 0
          ? "at least one corrective or preventive action must be planned"
          : undefined;
      },
    },
    {
      from: "implementation",
      to: "verification",
      guard: (capa) => {
        const unfinished = capa.actions.filter(
          (a) => a.status === "open" || a.status === "in-progress",
        );
        return unfinished.length > 0
          ? `${unfinished.length} action(s) not yet completed`
          : capa.effectiveness
            ? undefined
            : "an effectiveness check (criteria + due date) must be defined before verification";
      },
    },
    {
      from: "verification",
      to: "action-planning",
      guard: (capa) =>
        capa.effectiveness?.outcome === "not-effective"
          ? undefined
          : "returning to planning requires a recorded 'not-effective' outcome",
    },
    {
      from: "verification",
      to: "closed",
      guard: (capa) =>
        capa.effectiveness?.outcome === "effective"
          ? undefined
          : "closing requires an 'effective' effectiveness outcome",
    },
    { from: ["draft", "open", "investigation", "action-planning", "implementation", "verification"], to: "cancelled" },
  ],
  ["closed", "cancelled"],
);

export class CapaCase extends AggregateRoot<CapaProps> {
  private constructor(tenantId: TenantId, props: CapaProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static create(
    tenantId: TenantId,
    input: {
      capaNumber: string;
      type: CapaType;
      title: string;
      description: string;
      priority: CapaPriority;
      owner: UserId;
      riskRating?: RiskRating;
      source?: Partial<CapaSourceLinkage>;
    },
  ): CapaCase {
    if (!input.title.trim()) throw new DomainError("title is required", "VALIDATION");
    if (!input.description.trim()) throw new DomainError("description is required", "VALIDATION");
    const capa = new CapaCase(tenantId, {
      capaNumber: input.capaNumber,
      type: input.type,
      title: input.title.trim(),
      description: input.description.trim(),
      priority: input.priority,
      status: "draft",
      riskRating: input.riskRating,
      source: {
        ncrIds: input.source?.ncrIds ?? [],
        auditId: input.source?.auditId,
        supplierEventId: input.source?.supplierEventId,
        supplierId: input.source?.supplierId,
        customerRef: input.source?.customerRef,
      },
      actions: [],
      owner: input.owner,
      reworkCycles: 0,
    });
    capa.raise(
      envelope({
        eventType: QualityEventTypes.CapaCreated,
        aggregateType: "CapaCase",
        aggregateId: capa.id,
        tenantId,
        payload: {
          capaNumber: input.capaNumber,
          type: input.type,
          priority: input.priority,
          rpn: input.riskRating?.rpn,
          sourceNcrIds: capa.props.source.ncrIds,
        },
      }),
    );
    return capa;
  }

  static rehydrate(tenantId: TenantId, props: CapaProps, existing: Partial<EntityProps>): CapaCase {
    return new CapaCase(tenantId, props, existing);
  }

  get capaNumber(): string { return this.props.capaNumber; }
  get status(): CapaStatus { return this.props.status; }
  get type(): CapaType { return this.props.type; }
  get priority(): CapaPriority { return this.props.priority; }
  get owner(): UserId { return this.props.owner; }
  get rootCause(): RootCauseAnalysis | undefined { return this.props.rootCause; }
  get actions(): readonly CapaAction[] { return this.props.actions; }
  get effectiveness(): EffectivenessCheck | undefined { return this.props.effectiveness; }
  get source(): CapaSourceLinkage { return this.props.source; }
  get riskRating(): RiskRating | undefined { return this.props.riskRating; }
  get reworkCycles(): number { return this.props.reworkCycles; }

  private transition(to: CapaStatus): void {
    const from = this.props.status;
    this.props.status = capaMachine.assertTransition(from, to, this);
    const payload: CapaStateChangedPayload = {
      capaNumber: this.props.capaNumber,
      fromState: from,
      toState: to,
    };
    this.raise(
      envelope({
        eventType: QualityEventTypes.CapaStateChanged,
        aggregateType: "CapaCase",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload,
      }),
    );
  }

  submit(): void { this.transition("open"); }
  startInvestigation(): void { this.transition("investigation"); }

  recordRootCause(input: {
    method: RootCauseMethod;
    summary: string;
    causes: readonly { category?: string; description: string }[];
    completedBy: UserId;
  }): void {
    if (this.props.status !== "investigation") {
      throw new ConflictError(
        `Root cause can only be recorded during investigation (status: ${this.props.status})`,
      );
    }
    if (!input.summary.trim()) throw new DomainError("root cause summary is required", "VALIDATION");
    if (input.causes.length === 0) {
      throw new DomainError("at least one cause is required", "VALIDATION");
    }
    if (input.causes.some((c) => !c.description.trim())) {
      throw new DomainError("every cause needs a description", "VALIDATION");
    }
    this.props.rootCause = {
      method: input.method,
      summary: input.summary.trim(),
      causes: input.causes.map((c) => ({ category: c.category, description: c.description.trim() })),
      completedBy: input.completedBy,
      completedAt: nowIso(),
    };
    this.touch();
  }

  moveToActionPlanning(): void { this.transition("action-planning"); }

  addAction(input: { type: CapaActionType; description: string; owner: UserId; dueAt: IsoDateTime }): CapaAction {
    if (!["action-planning", "implementation"].includes(this.props.status)) {
      throw new ConflictError(
        `Actions can only be added during action-planning or implementation (status: ${this.props.status})`,
      );
    }
    if (!input.description.trim()) throw new DomainError("action description is required", "VALIDATION");
    const action: CapaAction = {
      id: newId("capact"),
      type: input.type,
      description: input.description.trim(),
      owner: input.owner,
      dueAt: input.dueAt,
      status: "open",
    };
    this.props.actions.push(action);
    this.raise(
      envelope({
        eventType: QualityEventTypes.CapaActionAdded,
        aggregateType: "CapaCase",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { capaNumber: this.props.capaNumber, actionId: action.id, actionType: input.type },
      }),
    );
    return action;
  }

  startAction(actionId: Ulid): CapaAction {
    return this.updateAction(actionId, (a) => {
      if (a.status !== "open") throw new ConflictError(`Action is '${a.status}', expected 'open'`);
      return { ...a, status: "in-progress" };
    });
  }

  completeAction(actionId: Ulid, note?: string): CapaAction {
    const updated = this.updateAction(actionId, (a) => {
      if (a.status !== "open" && a.status !== "in-progress") {
        throw new ConflictError(`Action is '${a.status}' and cannot be completed`);
      }
      return { ...a, status: "completed" as const, completedAt: nowIso(), completionNote: note };
    });
    this.raise(
      envelope({
        eventType: QualityEventTypes.CapaActionCompleted,
        aggregateType: "CapaCase",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { capaNumber: this.props.capaNumber, actionId },
      }),
    );
    return updated;
  }

  cancelAction(actionId: Ulid, reason: string): CapaAction {
    if (!reason.trim()) throw new DomainError("cancellation reason is required", "VALIDATION");
    return this.updateAction(actionId, (a) => {
      if (a.status === "completed") throw new ConflictError("Completed actions cannot be cancelled");
      if (a.status === "cancelled") throw new ConflictError("Action already cancelled");
      return { ...a, status: "cancelled" as const, completionNote: reason.trim() };
    });
  }

  private updateAction(actionId: Ulid, fn: (a: CapaAction) => CapaAction): CapaAction {
    const idx = this.props.actions.findIndex((a) => a.id === actionId);
    if (idx === -1) throw new DomainError(`CAPA action ${actionId} not found`, "NOT_FOUND", 404);
    const updated = fn(this.props.actions[idx]!);
    this.props.actions[idx] = updated;
    this.touch();
    return updated;
  }

  beginImplementation(): void { this.transition("implementation"); }

  defineEffectivenessCheck(input: { criteria: string; dueAt: IsoDateTime }): void {
    if (!["action-planning", "implementation"].includes(this.props.status)) {
      throw new ConflictError(
        `Effectiveness check can only be defined during planning/implementation (status: ${this.props.status})`,
      );
    }
    if (!input.criteria.trim()) throw new DomainError("effectiveness criteria is required", "VALIDATION");
    this.props.effectiveness = { criteria: input.criteria.trim(), dueAt: input.dueAt };
    this.touch();
  }

  requestVerification(): void { this.transition("verification"); }

  recordEffectiveness(input: {
    outcome: "effective" | "not-effective";
    verifiedBy: UserId;
    note?: string;
  }): void {
    if (this.props.status !== "verification") {
      throw new ConflictError(
        `Effectiveness can only be recorded during verification (status: ${this.props.status})`,
      );
    }
    const check = this.props.effectiveness;
    if (!check) throw new ConflictError("No effectiveness check defined");
    if (check.outcome) throw new ConflictError("Effectiveness outcome already recorded for this cycle");
    this.props.effectiveness = {
      ...check,
      outcome: input.outcome,
      verifiedBy: input.verifiedBy,
      verifiedAt: nowIso(),
      note: input.note,
    };
    this.raise(
      envelope({
        eventType: QualityEventTypes.CapaEffectivenessRecorded,
        aggregateType: "CapaCase",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { capaNumber: this.props.capaNumber, outcome: input.outcome },
      }),
    );
  }

  /** Verification failed: go back to planning for another cycle. */
  returnToPlanning(): void {
    this.transition("action-planning");
    this.props.reworkCycles += 1;
    // Reset the effectiveness outcome so the next cycle records a fresh one.
    if (this.props.effectiveness) {
      this.props.effectiveness = {
        criteria: this.props.effectiveness.criteria,
        dueAt: this.props.effectiveness.dueAt,
      };
    }
  }

  close(closedBy: UserId, note?: string): void {
    this.transition("closed");
    this.props.closure = { closedBy, closedAt: nowIso(), note };
    this.raise(
      envelope({
        eventType: QualityEventTypes.CapaClosed,
        aggregateType: "CapaCase",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          capaNumber: this.props.capaNumber,
          reworkCycles: this.props.reworkCycles,
          actionCount: this.props.actions.length,
        },
      }),
    );
  }

  cancel(cancelledBy: UserId, reason: string): void {
    if (!reason.trim()) throw new DomainError("Cancellation reason is required", "VALIDATION");
    this.transition("cancelled");
    this.props.cancellation = { cancelledBy, cancelledAt: nowIso(), reason: reason.trim() };
    this.raise(
      envelope({
        eventType: QualityEventTypes.CapaCancelled,
        aggregateType: "CapaCase",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { capaNumber: this.props.capaNumber, reason: reason.trim() },
      }),
    );
  }

  linkNcr(ncrId: Ulid): void {
    if (this.props.source.ncrIds.includes(ncrId)) return;
    this.props.source.ncrIds.push(ncrId);
    this.touch();
  }

  overdueActions(now: IsoDateTime): CapaAction[] {
    return this.props.actions.filter(
      (a) => (a.status === "open" || a.status === "in-progress") && a.dueAt < now,
    );
  }
}
