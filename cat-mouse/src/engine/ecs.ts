import type {
  Clock,
  ComponentId,
  ComponentType,
  Entity,
  EventBusLike,
  QuerySpec,
  Rng,
  System,
  SystemContext,
  WorldLike,
} from './types';
import { NULL_ENTITY } from './types';

let nextComponentId = 1;

/**
 * Declares a component. The `create` factory merges a per-instance override on
 * top of a defaults object so components stay plain data (cheap to clone/save).
 */
export function defineComponent<T extends object>(name: string, defaults: () => T): ComponentType<T> {
  const id = nextComponentId;
  nextComponentId += 1;
  return {
    id,
    name,
    create(init?: Partial<T>): T {
      const base = defaults();
      if (!init) return base;
      return Object.assign(base, init);
    },
  };
}

interface Store<T> {
  readonly type: ComponentType<T>;
  readonly data: Map<Entity, T>;
}

/**
 * Sparse-map ECS. Entity ids are recycled with a generation counter packed into
 * the high bits so a stale handle never resolves to a reused slot.
 */
export class World implements WorldLike {
  private readonly stores = new Map<ComponentId, Store<unknown>>();
  private readonly masks = new Map<Entity, Set<ComponentId>>();
  private readonly free: number[] = [];
  private readonly generations: number[] = [0];
  private nextIndex = 1;
  private queryVersion = 0;
  private readonly queryCache = new Map<string, { version: number; result: Entity[] }>();

  get entityCount(): number {
    return this.masks.size;
  }

  create(): Entity {
    let index: number;
    if (this.free.length > 0) {
      index = this.free.pop() as number;
    } else {
      index = this.nextIndex;
      this.nextIndex += 1;
      this.generations[index] = 0;
    }
    const generation = this.generations[index] as number;
    const entity = pack(index, generation);
    this.masks.set(entity, new Set());
    this.queryVersion += 1;
    return entity;
  }

  destroy(entity: Entity): void {
    const mask = this.masks.get(entity);
    if (!mask) return;
    for (const componentId of mask) {
      const store = this.stores.get(componentId);
      if (store) store.data.delete(entity);
    }
    this.masks.delete(entity);
    const index = indexOf(entity);
    this.generations[index] = ((this.generations[index] as number) + 1) & 0xff;
    this.free.push(index);
    this.queryVersion += 1;
  }

  alive(entity: Entity): boolean {
    if (entity === NULL_ENTITY) return false;
    return this.masks.has(entity);
  }

  add<T>(entity: Entity, type: ComponentType<T>, init?: Partial<T>): T {
    const mask = this.masks.get(entity);
    if (!mask) throw new Error(`World.add on dead entity ${entity}`);
    const store = this.storeOf(type);
    const value = type.create(init);
    store.data.set(entity, value);
    if (!mask.has(type.id)) {
      mask.add(type.id);
      this.queryVersion += 1;
    }
    return value;
  }

  set<T>(entity: Entity, type: ComponentType<T>, value: T): T {
    const mask = this.masks.get(entity);
    if (!mask) throw new Error(`World.set on dead entity ${entity}`);
    this.storeOf(type).data.set(entity, value);
    if (!mask.has(type.id)) {
      mask.add(type.id);
      this.queryVersion += 1;
    }
    return value;
  }

  get<T>(entity: Entity, type: ComponentType<T>): T | undefined {
    const store = this.stores.get(type.id) as Store<T> | undefined;
    if (!store) return undefined;
    return store.data.get(entity);
  }

  /** Throwing accessor for systems that already filtered on the component. */
  require<T>(entity: Entity, type: ComponentType<T>): T {
    const value = this.get(entity, type);
    if (value === undefined) {
      throw new Error(`Entity ${entity} is missing required component ${type.name}`);
    }
    return value;
  }

  has(entity: Entity, type: ComponentType<unknown>): boolean {
    const mask = this.masks.get(entity);
    return mask ? mask.has(type.id) : false;
  }

  remove(entity: Entity, type: ComponentType<unknown>): void {
    const mask = this.masks.get(entity);
    if (!mask || !mask.has(type.id)) return;
    mask.delete(type.id);
    const store = this.stores.get(type.id);
    if (store) store.data.delete(entity);
    this.queryVersion += 1;
  }

  query(spec: QuerySpec): readonly Entity[] {
    const key = cacheKey(spec);
    const cached = this.queryCache.get(key);
    if (cached && cached.version === this.queryVersion) return cached.result;
    const result: Entity[] = [];
    const all = spec.all ?? [];
    const none = spec.none ?? [];
    const any = spec.any ?? [];
    const driver = smallestStore(this, all);
    const candidates = driver ?? this.masks.keys();
    for (const entity of candidates) {
      const mask = this.masks.get(entity);
      if (!mask) continue;
      if (!matches(mask, all, none, any)) continue;
      result.push(entity);
    }
    result.sort((a, b) => a - b);
    this.queryCache.set(key, { version: this.queryVersion, result });
    return result;
  }

  /** Iterates entities holding a single component without building a query. */
  each<T>(type: ComponentType<T>, visit: (entity: Entity, value: T) => void): void {
    const store = this.stores.get(type.id) as Store<T> | undefined;
    if (!store) return;
    for (const [entity, value] of store.data) visit(entity, value);
  }

  countOf(type: ComponentType<unknown>): number {
    const store = this.stores.get(type.id);
    return store ? store.data.size : 0;
  }

  entities(): Entity[] {
    return [...this.masks.keys()].sort((a, b) => a - b);
  }

  componentsOf(entity: Entity): string[] {
    const mask = this.masks.get(entity);
    if (!mask) return [];
    const names: string[] = [];
    for (const id of mask) {
      const store = this.stores.get(id);
      if (store) names.push(store.type.name);
    }
    return names.sort();
  }

  clear(): void {
    this.stores.clear();
    this.masks.clear();
    this.free.length = 0;
    this.generations.length = 1;
    this.nextIndex = 1;
    this.queryVersion += 1;
    this.queryCache.clear();
  }

  internalStore<T>(type: ComponentType<T>): Map<Entity, T> {
    return this.storeOf(type).data;
  }

  private storeOf<T>(type: ComponentType<T>): Store<T> {
    let store = this.stores.get(type.id) as Store<T> | undefined;
    if (!store) {
      store = { type, data: new Map<Entity, T>() };
      this.stores.set(type.id, store as Store<unknown>);
    }
    return store;
  }
}

function matches(
  mask: Set<ComponentId>,
  all: readonly ComponentType<unknown>[],
  none: readonly ComponentType<unknown>[],
  any: readonly ComponentType<unknown>[],
): boolean {
  for (let i = 0; i < all.length; i += 1) {
    if (!mask.has((all[i] as ComponentType<unknown>).id)) return false;
  }
  for (let i = 0; i < none.length; i += 1) {
    if (mask.has((none[i] as ComponentType<unknown>).id)) return false;
  }
  if (any.length > 0) {
    let found = false;
    for (let i = 0; i < any.length; i += 1) {
      if (mask.has((any[i] as ComponentType<unknown>).id)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function smallestStore(world: World, all: readonly ComponentType<unknown>[]): Iterable<Entity> | null {
  if (all.length === 0) return null;
  let best: ComponentType<unknown> | null = null;
  let bestSize = Infinity;
  for (let i = 0; i < all.length; i += 1) {
    const type = all[i] as ComponentType<unknown>;
    const size = world.countOf(type);
    if (size < bestSize) {
      bestSize = size;
      best = type;
    }
  }
  if (!best) return null;
  return world.internalStore(best).keys();
}

function cacheKey(spec: QuerySpec): string {
  const part = (list?: readonly ComponentType<unknown>[]): string =>
    list && list.length > 0 ? list.map((t) => t.id).sort((a, b) => a - b).join('.') : '-';
  return `${part(spec.all)}|${part(spec.none)}|${part(spec.any)}`;
}

function pack(index: number, generation: number): Entity {
  return ((generation & 0xff) << 24) | (index & 0x00ffffff);
}

function indexOf(entity: Entity): number {
  return entity & 0x00ffffff;
}

export function generationOf(entity: Entity): number {
  return (entity >>> 24) & 0xff;
}

export function entityIndex(entity: Entity): number {
  return indexOf(entity);
}

/** Ordered system runner; `order` ascending, ties broken by insertion. */
export class SystemScheduler {
  private readonly systems: System[] = [];
  private dirty = false;
  private readonly timings = new Map<string, number>();

  add(system: System): this {
    this.systems.push(system);
    this.dirty = true;
    return this;
  }

  remove(name: string): boolean {
    const index = this.systems.findIndex((s) => s.name === name);
    if (index < 0) return false;
    this.systems.splice(index, 1);
    return true;
  }

  has(name: string): boolean {
    return this.systems.some((s) => s.name === name);
  }

  names(): string[] {
    this.sortIfNeeded();
    return this.systems.map((s) => s.name);
  }

  run(ctx: SystemContext): void {
    this.sortIfNeeded();
    for (let i = 0; i < this.systems.length; i += 1) {
      const system = this.systems[i] as System;
      if (system.enabled === false) continue;
      system.update(ctx);
    }
  }

  /** Same as `run` but records per-system wall time for the debug overlay. */
  runProfiled(ctx: SystemContext, now: () => number): void {
    this.sortIfNeeded();
    for (let i = 0; i < this.systems.length; i += 1) {
      const system = this.systems[i] as System;
      if (system.enabled === false) continue;
      const start = now();
      system.update(ctx);
      this.timings.set(system.name, now() - start);
    }
  }

  timing(name: string): number {
    return this.timings.get(name) ?? 0;
  }

  get size(): number {
    return this.systems.length;
  }

  private sortIfNeeded(): void {
    if (!this.dirty) return;
    this.systems.sort((a, b) => a.order - b.order);
    this.dirty = false;
  }
}

export function makeSystem(
  name: string,
  order: number,
  update: (ctx: SystemContext) => void,
  enabled = true,
): System {
  return { name, order, enabled, update };
}

export interface SystemContextInit {
  world: WorldLike;
  step: number;
  clock: Clock;
  rng: Rng;
  events: EventBusLike;
}

export function makeSystemContext(init: SystemContextInit): SystemContext {
  return init;
}
