import { AttributeService } from "../application/attribute-service.js";
import { BomService } from "../application/bom-service.js";
import { CategoryService } from "../application/category-service.js";
import { CostingService } from "../application/costing-service.js";
import { EcoService } from "../application/eco-service.js";
import type { Clock } from "../application/ports.js";
import { ProductService } from "../application/product-service.js";
import { UomService } from "../application/uom-service.js";
import {
  InMemoryAttributeDefinitionRepository,
  InMemoryAttributeSetRepository,
  InMemoryBomRepository,
  InMemoryCategoryRepository,
  InMemoryEcoRepository,
  InMemoryOutbox,
  InMemoryProductRepository,
  InMemoryUomRepository,
  SystemClock,
} from "./memory/stores.js";

/** Composition root: repositories, outbox, clock and application services. */
export interface PlmContainer {
  readonly repos: {
    readonly products: InMemoryProductRepository;
    readonly categories: InMemoryCategoryRepository;
    readonly attributeDefinitions: InMemoryAttributeDefinitionRepository;
    readonly attributeSets: InMemoryAttributeSetRepository;
    readonly uoms: InMemoryUomRepository;
    readonly boms: InMemoryBomRepository;
    readonly ecos: InMemoryEcoRepository;
  };
  readonly outbox: InMemoryOutbox;
  readonly clock: Clock;
  readonly services: {
    readonly uom: UomService;
    readonly attribute: AttributeService;
    readonly category: CategoryService;
    readonly product: ProductService;
    readonly bom: BomService;
    readonly costing: CostingService;
    readonly eco: EcoService;
  };
}

export function createContainer(options: { readonly clock?: Clock } = {}): PlmContainer {
  const clock = options.clock ?? new SystemClock();
  const outbox = new InMemoryOutbox();

  const products = new InMemoryProductRepository();
  const categories = new InMemoryCategoryRepository();
  const attributeDefinitions = new InMemoryAttributeDefinitionRepository();
  const attributeSets = new InMemoryAttributeSetRepository();
  const uoms = new InMemoryUomRepository();
  const boms = new InMemoryBomRepository();
  const ecos = new InMemoryEcoRepository();

  const uom = new UomService(uoms, outbox, clock);
  const attribute = new AttributeService(attributeDefinitions, attributeSets, outbox, clock);
  const category = new CategoryService(categories, outbox, clock);
  const product = new ProductService(
    products,
    categories,
    attributeSets,
    attributeDefinitions,
    boms,
    uom,
    outbox,
    clock,
  );
  const bom = new BomService(boms, products, ecos, uom, outbox, clock);
  const costing = new CostingService(products, bom, outbox, clock);
  const eco = new EcoService(ecos, products, boms, product, bom, outbox, clock);

  return {
    repos: { products, categories, attributeDefinitions, attributeSets, uoms, boms, ecos },
    outbox,
    clock,
    services: { uom, attribute, category, product, bom, costing, eco },
  };
}
