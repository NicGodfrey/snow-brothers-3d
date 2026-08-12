import {
  ConflictError,
  assertTransition,
  money,
  type IsoDate,
  type Money,
  type TenantId,
  type Ulid,
  type UserId,
} from "../../kernel/index.js";
import { AggregateRoot } from "../../kernel/aggregate.js";
import {
  OPPORTUNITY_STAGE_MACHINE,
  STAGE_PROBABILITY,
  isOpenStage,
  nextStage,
  type OpportunityStage,
} from "./stages.js";
import { OpportunityEventTypes, opportunityEvent } from "./events.js";

export interface OpportunityProps {
  accountId: Ulid;
  name: string;
  stage: OpportunityStage;
  amount: Money;
  probability: number;
  expectedCloseDate?: IsoDate;
  ownerId?: UserId;
  source?: string;
  lostReason?: string;
  wonQuoteId?: Ulid;
}

export class Opportunity extends AggregateRoot<OpportunityProps> {
  private constructor(tenantId: TenantId, props: OpportunityProps) {
    super(tenantId, props);
  }

  static create(
    tenantId: TenantId,
    input: {
      accountId: Ulid;
      name: string;
      amountMinor: number;
      currency: string;
      expectedCloseDate?: IsoDate;
      ownerId?: UserId;
      source?: string;
    },
  ): Opportunity {
    if (input.amountMinor < 0) {
      throw new ConflictError("Opportunity amount cannot be negative");
    }
    const opp = new Opportunity(tenantId, {
      accountId: input.accountId,
      name: input.name.trim(),
      stage: OPPORTUNITY_STAGE_MACHINE.initial,
      amount: money(input.amountMinor, input.currency),
      probability: STAGE_PROBABILITY[OPPORTUNITY_STAGE_MACHINE.initial],
      expectedCloseDate: input.expectedCloseDate,
      ownerId: input.ownerId,
      source: input.source,
    });
    opp.raise(
      opportunityEvent(OpportunityEventTypes.OpportunityCreated, opp.id, tenantId, {
        accountId: opp.props.accountId,
        name: opp.props.name,
        amountMinor: input.amountMinor,
        currency: input.currency.toUpperCase(),
      }),
    );
    return opp;
  }

  get accountId(): Ulid {
    return this.props.accountId;
  }

  get name(): string {
    return this.props.name;
  }

  get stage(): OpportunityStage {
    return this.props.stage;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get probability(): number {
    return this.props.probability;
  }

  get isOpen(): boolean {
    return isOpenStage(this.props.stage);
  }

  /** Weighted value = amount * probability, used for pipeline reporting. */
  get weightedAmountMinor(): number {
    return Math.round(((this.props.amount.amountMinor as unknown as number) * this.props.probability) / 100);
  }

  moveToStage(target: OpportunityStage): void {
    if (target === "closed_won" || target === "closed_lost") {
      throw new ConflictError("Use win()/lose() to close an opportunity");
    }
    assertTransition(OPPORTUNITY_STAGE_MACHINE, this.props.stage, target);
    this.changeStage(target);
  }

  advanceStage(): void {
    const target = nextStage(this.props.stage);
    if (!target) {
      throw new ConflictError(`Opportunity in stage ${this.props.stage} cannot advance further; close it instead`);
    }
    this.changeStage(target);
  }

  reviseAmount(amountMinor: number): void {
    this.assertOpen();
    if (amountMinor < 0) throw new ConflictError("Opportunity amount cannot be negative");
    this.props.amount = money(amountMinor, this.props.amount.currency);
    this.raise(
      opportunityEvent(OpportunityEventTypes.OpportunityAmountRevised, this.id, this.tenantId, {
        amountMinor,
        currency: this.props.amount.currency,
      }),
    );
  }

  win(wonQuoteId?: Ulid): void {
    assertTransition(OPPORTUNITY_STAGE_MACHINE, this.props.stage, "closed_won");
    this.props.stage = "closed_won";
    this.props.probability = STAGE_PROBABILITY.closed_won;
    this.props.wonQuoteId = wonQuoteId;
    this.raise(
      opportunityEvent(OpportunityEventTypes.OpportunityWon, this.id, this.tenantId, {
        stage: "closed_won",
        amountMinor: this.props.amount.amountMinor as unknown as number,
        currency: this.props.amount.currency as unknown as string,
      }),
    );
  }

  lose(reason: string): void {
    assertTransition(OPPORTUNITY_STAGE_MACHINE, this.props.stage, "closed_lost");
    if (!reason.trim()) throw new ConflictError("A lost reason is required");
    this.props.stage = "closed_lost";
    this.props.probability = STAGE_PROBABILITY.closed_lost;
    this.props.lostReason = reason.trim();
    this.raise(
      opportunityEvent(OpportunityEventTypes.OpportunityLost, this.id, this.tenantId, {
        stage: "closed_lost",
        amountMinor: this.props.amount.amountMinor as unknown as number,
        currency: this.props.amount.currency as unknown as string,
        lostReason: this.props.lostReason,
      }),
    );
  }

  private changeStage(target: OpportunityStage): void {
    const from = this.props.stage;
    assertTransition(OPPORTUNITY_STAGE_MACHINE, from, target);
    this.props.stage = target;
    this.props.probability = STAGE_PROBABILITY[target];
    this.raise(
      opportunityEvent(OpportunityEventTypes.OpportunityStageChanged, this.id, this.tenantId, {
        fromStage: from,
        toStage: target,
        probability: this.props.probability,
      }),
    );
  }

  private assertOpen(): void {
    if (!this.isOpen) {
      throw new ConflictError(`Opportunity is closed (${this.props.stage})`);
    }
  }
}
