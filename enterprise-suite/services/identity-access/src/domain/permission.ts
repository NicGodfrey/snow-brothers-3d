import { IDENTITY_ERROR, IdentityError } from "./errors.js";
import {
  permissionAction,
  permissionKey,
  permissionResource,
  type PermissionKey,
} from "./permission-key.js";

/**
 * Permissions are declared, not invented at grant time: an unknown key in a check is a
 * bug, and an unknown key in a grant is usually a typo that would silently never match.
 */
export interface PermissionDefinition {
  readonly key: PermissionKey;
  readonly resource: string;
  readonly action: string;
  readonly description: string;
  /** Grouping for admin UIs, e.g. "Identity", "Sales". */
  readonly category: string;
  /** False for tenant-wide-only capabilities such as billing administration. */
  readonly scopable: boolean;
  /** Flags destructive capabilities so UIs can require extra confirmation. */
  readonly dangerous: boolean;
}

export interface PermissionInput {
  readonly key: string;
  readonly description: string;
  readonly category: string;
  readonly scopable?: boolean;
  readonly dangerous?: boolean;
}

export function definePermission(input: PermissionInput): PermissionDefinition {
  const key = permissionKey(input.key);
  return {
    key,
    resource: permissionResource(key),
    action: permissionAction(key),
    description: input.description,
    category: input.category,
    scopable: input.scopable ?? true,
    dangerous: input.dangerous ?? false,
  };
}

/**
 * Registry of every permission the platform understands. Built-ins are registered at
 * bootstrap; other bounded contexts add their own keys at startup.
 */
export class PermissionCatalog {
  private readonly byKey = new Map<string, PermissionDefinition>();

  constructor(definitions: readonly PermissionDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: PermissionDefinition): PermissionDefinition {
    const existing = this.byKey.get(definition.key);
    if (existing && existing.description !== definition.description) {
      throw new IdentityError(
        `Permission ${definition.key} is already registered with a different definition`,
        IDENTITY_ERROR.invalidPermissionKey,
        409,
      );
    }
    this.byKey.set(definition.key, definition);
    return definition;
  }

  registerAll(definitions: readonly PermissionDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  has(key: PermissionKey): boolean {
    return this.byKey.has(key);
  }

  get(key: PermissionKey): PermissionDefinition | undefined {
    return this.byKey.get(key);
  }

  require(key: PermissionKey): PermissionDefinition {
    const definition = this.byKey.get(key);
    if (!definition) {
      throw new IdentityError(
        `Unknown permission "${key}"`,
        IDENTITY_ERROR.unknownPermission,
        422,
      );
    }
    return definition;
  }

  list(): readonly PermissionDefinition[] {
    return [...this.byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  byCategory(category: string): readonly PermissionDefinition[] {
    return this.list().filter((definition) => definition.category === category);
  }

  byResource(resource: string): readonly PermissionDefinition[] {
    return this.list().filter(
      (definition) =>
        definition.resource === resource || definition.resource.startsWith(`${resource}.`),
    );
  }

  categories(): readonly string[] {
    return [...new Set(this.list().map((definition) => definition.category))].sort();
  }

  search(term: string): readonly PermissionDefinition[] {
    const needle = term.trim().toLowerCase();
    if (needle === "") return this.list();
    return this.list().filter(
      (definition) =>
        definition.key.includes(needle) ||
        definition.description.toLowerCase().includes(needle) ||
        definition.category.toLowerCase().includes(needle),
    );
  }

  get size(): number {
    return this.byKey.size;
  }
}
