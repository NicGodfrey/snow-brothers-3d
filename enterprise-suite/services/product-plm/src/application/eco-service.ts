import {
  NotFoundError,
  normalizePage,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { Eco, type EcoChange, type EcoItem, type EcoPriority, type EcoReason } from "../domain/eco.js";
import { InvalidStateError } from "../domain/errors.js";
import type { BomService } from "./bom-service.js";
import type { BomRepository, Clock, EcoFilter, EcoRepository, OutboxPort, ProductRepository } from "./ports.js";
import type { ProductService } from "./product-service.js";

export interface CreateEcoCommand {
  readonly title: string;
  readonly description?: string;
  readonly reason: EcoReason;
  readonly priority?: EcoPriority;
  readonly requiredApprovals?: number;
}

export interface AddEcoItemCommand {
  readonly productId: Ulid;
  readonly change: EcoChange;
  readonly description?: string;
}

/**
 * ECO workflow orchestration. The aggregate owns the state machine; this
 * service adds cross-aggregate validation when items are attached and applies
 * the approved changes to the affected aggregates on implementation.
 */
export class EcoService {
  constructor(
    private readonly ecos: EcoRepository,
    private readonly products: ProductRepository,
    private readonly boms: BomRepository,
    private readonly productService: ProductService,
    private readonly bomService: BomService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async create(ctx: TenantContext, command: CreateEcoCommand): Promise<Eco> {
    const sequence = await this.ecos.nextSequence(ctx.tenantId);
    const eco = Eco.create(ctx.tenantId, {
      ...command,
      number: `ECO-${String(sequence).padStart(5, "0")}`,
    });
    await this.commit(eco);
    return eco;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<Eco> {
    const eco = await this.ecos.byId(ctx.tenantId, id);
    if (!eco) throw new NotFoundError("Eco", id);
    return eco;
  }

  async list(ctx: TenantContext, filter: EcoFilter, page?: Partial<PageRequest>): Promise<Page<Eco>> {
    return this.ecos.list(ctx.tenantId, filter, normalizePage(page));
  }

  /** Attaches a change item after checking its references exist and fit. */
  async addItem(ctx: TenantContext, ecoId: Ulid, command: AddEcoItemCommand): Promise<EcoItem> {
    const eco = await this.get(ctx, ecoId);
    const product = await this.products.byId(ctx.tenantId, command.productId);
    if (!product) throw new NotFoundError("Product", command.productId);

    const change = command.change;
    if (change.kind === "bom_release") {
      const bom = await this.boms.byProductId(ctx.tenantId, command.productId);
      const revision = bom?.revisionById(change.bomRevisionId);
      if (!bom || !revision) {
        throw new NotFoundError("BomRevision", change.bomRevisionId);
      }
      if (revision.status !== "draft") {
        throw new InvalidStateError(
          `Revision ${revision.code} is ${revision.status}; an ECO can only release drafts`,
        );
      }
    } else if (change.kind === "variant_discontinue") {
      const variant = product.variantById(change.variantId);
      if (!variant) throw new NotFoundError("Variant", change.variantId);
      if (variant.status === "discontinued") {
        throw new InvalidStateError(`Variant ${variant.sku} is already discontinued`);
      }
    }
    const item = eco.addItem(command);
    await this.commit(eco);
    return item;
  }

  async removeItem(ctx: TenantContext, ecoId: Ulid, itemId: Ulid): Promise<Eco> {
    const eco = await this.get(ctx, ecoId);
    eco.removeItem(itemId);
    await this.commit(eco);
    return eco;
  }

  async submit(ctx: TenantContext, ecoId: Ulid): Promise<Eco> {
    const eco = await this.get(ctx, ecoId);
    eco.submit(ctx.userId, this.clock.now());
    await this.commit(eco);
    return eco;
  }

  async approve(ctx: TenantContext, ecoId: Ulid, comment?: string): Promise<Eco> {
    const eco = await this.get(ctx, ecoId);
    eco.recordDecision(ctx.userId, "approved", this.clock.now(), comment);
    await this.commit(eco);
    return eco;
  }

  async reject(ctx: TenantContext, ecoId: Ulid, comment: string): Promise<Eco> {
    const eco = await this.get(ctx, ecoId);
    eco.recordDecision(ctx.userId, "rejected", this.clock.now(), comment);
    await this.commit(eco);
    return eco;
  }

  async cancel(ctx: TenantContext, ecoId: Ulid, reason: string): Promise<Eco> {
    const eco = await this.get(ctx, ecoId);
    eco.cancel(reason);
    await this.commit(eco);
    return eco;
  }

  /**
   * Applies every change item of an approved ECO, then marks it implemented.
   *
   * Items are applied in insertion order, so an ECO can first release a BOM
   * revision and then activate the product in one change. A dry validation
   * pass re-checks that referenced aggregates still exist before any mutation;
   * state-dependent guards (lifecycle legality, effectivity conflicts) are
   * enforced by the aggregates during application and abort the whole
   * implementation on first failure.
   */
  async implement(ctx: TenantContext, ecoId: Ulid): Promise<Eco> {
    const eco = await this.get(ctx, ecoId);
    if (eco.status !== "approved") {
      throw new InvalidStateError(`ECO ${eco.number} is ${eco.status}; only approved ECOs can be implemented`);
    }

    for (const item of eco.items) {
      const product = await this.products.byId(ctx.tenantId, item.productId);
      if (!product) throw new NotFoundError("Product", item.productId);
      if (item.change.kind === "bom_release") {
        const bom = await this.boms.byProductId(ctx.tenantId, item.productId);
        const revision = bom?.revisionById(item.change.bomRevisionId);
        if (!revision) throw new NotFoundError("BomRevision", item.change.bomRevisionId);
        if (revision.status !== "draft") {
          throw new InvalidStateError(
            `Revision ${revision.code} is ${revision.status}; it may have been released outside this ECO`,
          );
        }
      }
    }

    for (const item of eco.items) {
      const change = item.change;
      switch (change.kind) {
        case "bom_release":
          await this.bomService.releaseRevision(ctx, item.productId, change.bomRevisionId, {
            effectiveFrom: change.effectiveFrom,
            effectiveTo: change.effectiveTo,
            ecoId: eco.id,
          });
          break;
        case "lifecycle_transition":
          await this.productService.transitionLifecycle(ctx, item.productId, change.to, change.reason);
          break;
        case "attribute_update":
          await this.productService.setAttributes(ctx, item.productId, { ...change.values });
          break;
        case "variant_discontinue":
          await this.productService.discontinueVariant(ctx, item.productId, change.variantId);
          break;
      }
    }

    eco.markImplemented(ctx.userId, this.clock.now());
    await this.commit(eco);
    return eco;
  }

  private async commit(eco: Eco): Promise<void> {
    await this.ecos.save(eco);
    await this.outbox.publish(eco.pullEvents());
  }
}
