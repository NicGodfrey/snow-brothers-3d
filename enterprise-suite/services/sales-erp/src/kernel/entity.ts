import { newId, nowIso, type IsoDateTime, type Ulid } from "./brand.js";
import type { TenantId } from "./tenant.js";

export interface EntityProps {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly version: number;
}

export abstract class Entity<TProps extends object> {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  version: number;
  protected props: TProps;

  protected constructor(tenantId: TenantId, props: TProps, existing?: Partial<EntityProps>) {
    this.id = existing?.id ?? newId(this.constructor.name.toLowerCase());
    this.tenantId = tenantId;
    this.createdAt = existing?.createdAt ?? nowIso();
    this.updatedAt = existing?.updatedAt ?? nowIso();
    this.version = existing?.version ?? 1;
    this.props = props;
  }

  touch(): void {
    this.updatedAt = nowIso();
    this.version += 1;
  }

  toJSON(): EntityProps & TProps {
    return {
      id: this.id,
      tenantId: this.tenantId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      version: this.version,
      ...this.props,
    };
  }
}
