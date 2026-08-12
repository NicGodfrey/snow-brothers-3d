import {
  ConflictError,
  NotFoundError,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { Bom, type BomLine, type BomLineInput, type BomRevision } from "../domain/bom.js";
import { InvalidStateError, ValidationError } from "../domain/errors.js";
import {
  explodeBom,
  summarizeExplosion,
  type ExplosionResult,
  type ExplosionSummaryLine,
} from "../domain/explosion.js";
import type { Product } from "../domain/product.js";
import type { BomRepository, Clock, EcoRepository, OutboxPort, ProductRepository } from "./ports.js";
import type { UomService } from "./uom-service.js";

export interface AddBomLineCommand {
  readonly componentProductId: Ulid;
  readonly componentVariantId?: Ulid;
  readonly quantity: number;
  readonly uom: string;
  readonly scrapFactor?: number;
  readonly referenceDesignators?: readonly string[];
  readonly notes?: string;
}

export interface ReleaseRevisionCommand {
  readonly effectiveFrom: IsoDateTime;
  readonly effectiveTo?: IsoDateTime;
  readonly ecoId?: Ulid;
}

export class BomService {
  constructor(
    private readonly boms: BomRepository,
    private readonly products: ProductRepository,
    private readonly ecos: EcoRepository,
    private readonly uomService: UomService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  /** Creates the (single) BOM for a product together with an initial draft. */
  async createBom(ctx: TenantContext, productId: Ulid): Promise<Bom> {
    const product = await this.mustGetProduct(ctx, productId);
    if (!product.canHaveBom()) {
      throw new InvalidStateError(
        `Product ${product.code} is type "${product.type}"; only manufactured/phantom products carry a BOM`,
      );
    }
    if (await this.boms.byProductId(ctx.tenantId, productId)) {
      throw new ConflictError(`Product ${product.code} already has a BOM`);
    }
    const bom = Bom.create(ctx.tenantId, productId);
    bom.createDraftRevision();
    await this.commit(bom);
    return bom;
  }

  async getByProduct(ctx: TenantContext, productId: Ulid): Promise<Bom> {
    const bom = await this.boms.byProductId(ctx.tenantId, productId);
    if (!bom) throw new NotFoundError("Bom", `product ${productId}`);
    return bom;
  }

  async createDraftRevision(
    ctx: TenantContext,
    productId: Ulid,
    input: { readonly basedOnRevisionId?: Ulid; readonly notes?: string } = {},
  ): Promise<BomRevision> {
    const bom = await this.getByProduct(ctx, productId);
    const revision = bom.createDraftRevision(input);
    await this.commit(bom);
    return revision;
  }

  /**
   * Adds a line after cross-aggregate validation: the component must exist
   * and not be end-of-life, a pinned variant must be an active variant of the
   * component, the line UoM must be dimension-compatible with the component's
   * base UoM, and the edge must not close a cycle anywhere in the tenant's
   * BOM graph (checked conservatively across all revisions).
   */
  async addLine(
    ctx: TenantContext,
    productId: Ulid,
    revisionId: Ulid,
    command: AddBomLineCommand,
  ): Promise<BomLine> {
    const bom = await this.getByProduct(ctx, productId);
    const component = await this.mustGetProduct(ctx, command.componentProductId);
    if (component.lifecycle === "end_of_life") {
      throw new InvalidStateError(`Component ${component.code} is end-of-life and cannot be added to a BOM`);
    }
    if (command.componentVariantId) {
      const variant = component.variantById(command.componentVariantId);
      if (!variant) {
        throw new NotFoundError("Variant", command.componentVariantId);
      }
      if (variant.status !== "active") {
        throw new InvalidStateError(`Variant ${variant.sku} is discontinued`);
      }
    }
    const registry = await this.uomService.registryFor(ctx.tenantId);
    const lineUom = registry.resolve(command.uom).code;
    if (!registry.sameDimension(lineUom, component.baseUom)) {
      throw ValidationError.single(
        "uom",
        `line unit ${lineUom} is not convertible to component base unit ${component.baseUom}`,
      );
    }
    if (await this.wouldCreateCycle(ctx, productId, command.componentProductId)) {
      throw new ConflictError(
        `Adding ${component.code} would create a cycle: it already contains ${productId} in its structure`,
      );
    }
    const input: BomLineInput = { ...command, uom: lineUom };
    const line = bom.addLine(revisionId, input);
    await this.commit(bom);
    return line;
  }

  async updateLine(
    ctx: TenantContext,
    productId: Ulid,
    revisionId: Ulid,
    lineId: Ulid,
    patch: Partial<Pick<BomLine, "quantity" | "scrapFactor" | "referenceDesignators" | "notes">> & {
      readonly uom?: string;
    },
  ): Promise<BomLine> {
    const bom = await this.getByProduct(ctx, productId);
    let uom: BomLine["uom"] | undefined;
    if (patch.uom !== undefined) {
      const registry = await this.uomService.registryFor(ctx.tenantId);
      uom = registry.resolve(patch.uom).code;
      const existing = bom.revisionById(revisionId)?.lines.find((l) => l.id === lineId);
      if (existing) {
        const component = await this.mustGetProduct(ctx, existing.componentProductId);
        if (!registry.sameDimension(uom, component.baseUom)) {
          throw ValidationError.single(
            "uom",
            `line unit ${uom} is not convertible to component base unit ${component.baseUom}`,
          );
        }
      }
    }
    const line = bom.updateLine(revisionId, lineId, { ...patch, ...(uom !== undefined ? { uom } : {}) });
    await this.commit(bom);
    return line;
  }

  async removeLine(ctx: TenantContext, productId: Ulid, revisionId: Ulid, lineId: Ulid): Promise<void> {
    const bom = await this.getByProduct(ctx, productId);
    bom.removeLine(revisionId, lineId);
    await this.commit(bom);
  }

  /**
   * Releases a draft revision. The first release of a BOM may be direct;
   * every subsequent release must be authorized by an *approved* ECO that
   * carries a bom_release item for exactly this revision.
   */
  async releaseRevision(
    ctx: TenantContext,
    productId: Ulid,
    revisionId: Ulid,
    command: ReleaseRevisionCommand,
  ): Promise<BomRevision> {
    const bom = await this.getByProduct(ctx, productId);
    if (bom.hasEverBeenReleased()) {
      if (!command.ecoId) {
        throw new InvalidStateError(
          `BOM for product ${productId} already has released revisions; further releases require an approved ECO`,
        );
      }
      const eco = await this.ecos.byId(ctx.tenantId, command.ecoId);
      if (!eco) throw new NotFoundError("Eco", command.ecoId);
      if (eco.status !== "approved") {
        throw new InvalidStateError(`ECO ${eco.number} is ${eco.status}; only approved ECOs authorize releases`);
      }
      const authorizes = eco.items.some(
        (i) => i.change.kind === "bom_release" && i.change.bomRevisionId === revisionId,
      );
      if (!authorizes) {
        throw new InvalidStateError(`ECO ${eco.number} does not cover revision ${revisionId}`);
      }
    }
    const revision = bom.release(revisionId, {
      effectiveFrom: command.effectiveFrom,
      effectiveTo: command.effectiveTo,
      releasedBy: ctx.userId,
      at: this.clock.now(),
      ecoId: command.ecoId,
    });
    await this.commit(bom);
    return revision;
  }

  async obsoleteRevision(ctx: TenantContext, productId: Ulid, revisionId: Ulid): Promise<BomRevision> {
    const bom = await this.getByProduct(ctx, productId);
    const revision = bom.obsoleteRevision(revisionId, this.clock.now());
    await this.commit(bom);
    return revision;
  }

  async effectiveRevision(ctx: TenantContext, productId: Ulid, at?: IsoDateTime): Promise<BomRevision> {
    const bom = await this.getByProduct(ctx, productId);
    const revision = bom.effectiveRevision(at ?? this.clock.now());
    if (!revision) {
      throw new NotFoundError("Effective BOM revision", `product ${productId} at ${at ?? this.clock.now()}`);
    }
    return revision;
  }

  async explode(
    ctx: TenantContext,
    productId: Ulid,
    options: { readonly at?: IsoDateTime; readonly quantity?: number; readonly flattenPhantoms?: boolean } = {},
  ): Promise<ExplosionResult> {
    const sources = await this.buildSources(ctx);
    return explodeBom(sources, productId, {
      at: options.at ?? this.clock.now(),
      quantity: options.quantity,
      flattenPhantoms: options.flattenPhantoms,
    });
  }

  async requirements(
    ctx: TenantContext,
    productId: Ulid,
    options: { readonly at?: IsoDateTime; readonly quantity?: number } = {},
  ): Promise<ExplosionSummaryLine[]> {
    return summarizeExplosion(await this.explode(ctx, productId, options));
  }

  /** Sync read model over async repos for the domain-level tree walkers. */
  async buildSources(ctx: TenantContext): Promise<{
    productById: (id: Ulid) => Product | undefined;
    bomByProductId: (productId: Ulid) => Bom | undefined;
    registry: Awaited<ReturnType<UomService["registryFor"]>>;
  }> {
    const [products, boms, registry] = await Promise.all([
      this.products.all(ctx.tenantId),
      this.boms.all(ctx.tenantId),
      this.uomService.registryFor(ctx.tenantId),
    ]);
    const productMap = new Map(products.map((p) => [p.id, p]));
    const bomMap = new Map(boms.map((b) => [b.productId, b]));
    return {
      productById: (id) => productMap.get(id),
      bomByProductId: (productId) => bomMap.get(productId),
      registry,
    };
  }

  /** DFS over every revision of every BOM: can `componentId` reach `parentId`? */
  private async wouldCreateCycle(ctx: TenantContext, parentId: Ulid, componentId: Ulid): Promise<boolean> {
    if (parentId === componentId) return true;
    const boms = await this.boms.all(ctx.tenantId);
    const adjacency = new Map<Ulid, Set<Ulid>>();
    for (const bom of boms) {
      const targets = adjacency.get(bom.productId) ?? new Set<Ulid>();
      for (const revision of bom.revisions) {
        for (const line of revision.lines) targets.add(line.componentProductId);
      }
      adjacency.set(bom.productId, targets);
    }
    const stack = [componentId];
    const visited = new Set<Ulid>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === parentId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of adjacency.get(current) ?? []) stack.push(next);
    }
    return false;
  }

  private async mustGetProduct(ctx: TenantContext, id: Ulid): Promise<Product> {
    const product = await this.products.byId(ctx.tenantId, id);
    if (!product) throw new NotFoundError("Product", id);
    return product;
  }

  private async commit(bom: Bom): Promise<void> {
    await this.boms.save(bom);
    await this.outbox.publish(bom.pullEvents());
  }
}
