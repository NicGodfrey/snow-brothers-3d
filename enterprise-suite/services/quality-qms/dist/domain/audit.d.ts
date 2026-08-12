/**
 * Audit checklists and audit execution.
 *
 * Two aggregates:
 *
 * 1. AuditChecklistTemplate — a reusable checklist (e.g. "ISO 9001:2015
 *    internal audit", "Supplier process audit") organised into sections
 *    of items. Each item declares how it is answered:
 *      - "conformity": conform / minor-nc / major-nc / not-applicable
 *      - "score":      0..5
 *      - "yes-no":     yes / no / not-applicable
 *
 * 2. Audit — one execution of a template against an auditee (site,
 *    department or supplier). The audit snapshots the template items,
 *    collects responses, findings (observations, OFIs, minor/major
 *    non-conformities) and computes a weighted score on completion.
 *
 * Workflow: planned -> in-progress -> review -> completed -> closed
 *           (planned | in-progress) -> cancelled
 *
 * Closing rule: every major-nc finding must be linked to an NCR or CAPA
 * before the audit can be closed — this is what forces audit findings
 * into the corrective-action loop.
 */
import { AggregateRoot, type EntityProps, type IsoDateTime, type TenantId, type Ulid, type UserId } from "@enterprise-suite/shared-kernel";
export type AnswerType = "conformity" | "score" | "yes-no";
export type TemplateStatus = "draft" | "active" | "retired";
export interface ChecklistItem {
    readonly id: Ulid;
    readonly question: string;
    readonly answerType: AnswerType;
    readonly guidance?: string;
    /** e.g. "ISO9001:2015 §8.5.1" */
    readonly requirementRef?: string;
    /** Relative weight in the score computation (default 1). */
    readonly weight: number;
}
export interface ChecklistSection {
    readonly id: Ulid;
    readonly title: string;
    readonly items: ChecklistItem[];
}
interface TemplateProps {
    code: string;
    title: string;
    standard?: string;
    status: TemplateStatus;
    sections: ChecklistSection[];
}
export declare class AuditChecklistTemplate extends AggregateRoot<TemplateProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        code: string;
        title: string;
        standard?: string;
    }): AuditChecklistTemplate;
    static rehydrate(tenantId: TenantId, props: TemplateProps, existing: Partial<EntityProps>): AuditChecklistTemplate;
    get code(): string;
    get status(): TemplateStatus;
    get sections(): readonly ChecklistSection[];
    get standard(): string | undefined;
    private assertDraft;
    addSection(title: string): ChecklistSection;
    addItem(sectionId: Ulid, input: {
        question: string;
        answerType: AnswerType;
        guidance?: string;
        requirementRef?: string;
        weight?: number;
    }): ChecklistItem;
    activate(): void;
    retire(): void;
}
export type AuditType = "internal" | "supplier" | "process" | "certification";
export type AuditStatus = "planned" | "in-progress" | "review" | "completed" | "closed" | "cancelled";
export type ConformityAnswer = "conform" | "minor-nc" | "major-nc" | "not-applicable";
export type YesNoAnswer = "yes" | "no" | "not-applicable";
export type ItemAnswer = {
    readonly kind: "conformity";
    readonly value: ConformityAnswer;
} | {
    readonly kind: "score";
    readonly value: number;
} | {
    readonly kind: "yes-no";
    readonly value: YesNoAnswer;
};
export interface ItemResponse {
    readonly itemId: Ulid;
    readonly answer: ItemAnswer;
    readonly evidence?: string;
    readonly comment?: string;
    readonly answeredBy: UserId;
    readonly answeredAt: IsoDateTime;
}
export type FindingClassification = "observation" | "ofi" | "minor-nc" | "major-nc";
export interface AuditFinding {
    readonly id: Ulid;
    readonly classification: FindingClassification;
    readonly description: string;
    readonly itemId?: Ulid;
    readonly requirementRef?: string;
    readonly ncrId?: Ulid;
    readonly capaId?: Ulid;
    readonly recordedBy: UserId;
    readonly recordedAt: IsoDateTime;
}
export interface Auditee {
    readonly site?: string;
    readonly department?: string;
    readonly supplierId?: string;
}
export interface AuditResult {
    readonly scorePercent: number;
    readonly achievedPoints: number;
    readonly maxPoints: number;
    readonly outcome: "pass" | "conditional" | "fail";
    readonly summary?: string;
}
interface AuditProps {
    auditNumber: string;
    auditType: AuditType;
    templateId: Ulid;
    templateCode: string;
    scope: string;
    auditee: Auditee;
    leadAuditor: UserId;
    auditors: UserId[];
    plannedFrom: IsoDateTime;
    plannedTo: IsoDateTime;
    status: AuditStatus;
    /** Snapshot of template sections at planning time. */
    sections: ChecklistSection[];
    responses: ItemResponse[];
    findings: AuditFinding[];
    result?: AuditResult;
    cancellationReason?: string;
}
export declare class Audit extends AggregateRoot<AuditProps> {
    private constructor();
    static plan(tenantId: TenantId, input: {
        auditNumber: string;
        auditType: AuditType;
        template: AuditChecklistTemplate;
        scope: string;
        auditee: Auditee;
        leadAuditor: UserId;
        auditors?: UserId[];
        plannedFrom: IsoDateTime;
        plannedTo: IsoDateTime;
    }): Audit;
    static rehydrate(tenantId: TenantId, props: AuditProps, existing: Partial<EntityProps>): Audit;
    get auditNumber(): string;
    get auditType(): AuditType;
    get status(): AuditStatus;
    get auditee(): Auditee;
    get sections(): readonly ChecklistSection[];
    get responses(): readonly ItemResponse[];
    get findings(): readonly AuditFinding[];
    get result(): AuditResult | undefined;
    get templateId(): Ulid;
    private allItems;
    unansweredItemCount(): number;
    start(): void;
    answerItem(itemId: Ulid, answer: ItemAnswer, answeredBy: UserId, details?: {
        evidence?: string;
        comment?: string;
    }): ItemResponse;
    recordFinding(input: {
        classification: FindingClassification;
        description: string;
        itemId?: Ulid;
        requirementRef?: string;
        recordedBy: UserId;
    }): AuditFinding;
    linkFinding(findingId: Ulid, link: {
        ncrId?: Ulid;
        capaId?: Ulid;
    }): AuditFinding;
    moveToReview(): void;
    /**
     * Scoring: each answered item contributes weight * factor where factor is
     *   conformity: conform=1, minor-nc=0.5, major-nc=0
     *   score:      value / 5
     *   yes-no:     yes=1, no=0
     * "not-applicable" answers are excluded from both numerator and
     * denominator. Outcome: >=85% pass, >=70% conditional, otherwise fail.
     */
    complete(summary?: string): AuditResult;
    close(): void;
    cancel(reason: string): void;
}
export {};
//# sourceMappingURL=audit.d.ts.map