import {
  AggregateRoot,
  ConflictError,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { IDENTITY_ERROR, ValidationError } from "./errors.js";
import { IDENTITY_EVENT, identityEvent } from "./events.js";
import { newGroupId } from "./ids.js";

interface GroupProps {
  name: string;
  description: string;
  parentGroupId?: Ulid;
  memberUserIds: Ulid[];
  /** Groups synced from an external IdP are read-only for membership changes. */
  externallyManaged: boolean;
  externalRef?: string;
}

/**
 * Groups exist so role bindings can be granted once to a team instead of per user.
 * Nesting is allowed (a group can have a parent); cycle prevention lives in the service
 * because it needs to see the other groups.
 */
export class Group extends AggregateRoot<GroupProps> {
  private constructor(tenantId: TenantId, props: GroupProps, id?: Ulid, createdAt?: IsoDateTime) {
    super(tenantId, props, { id: id ?? newGroupId(), createdAt });
  }

  static create(input: {
    tenantId: TenantId;
    name: string;
    description?: string;
    parentGroupId?: Ulid;
    externallyManaged?: boolean;
    externalRef?: string;
  }): Group {
    const name = input.name.trim();
    if (name.length < 2) {
      throw new ValidationError("Group name is too short", IDENTITY_ERROR.invalidUserState);
    }
    const group = new Group(input.tenantId, {
      name,
      description: input.description?.trim() ?? "",
      parentGroupId: input.parentGroupId,
      memberUserIds: [],
      externallyManaged: input.externallyManaged ?? false,
      externalRef: input.externalRef,
    });
    group.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.groupCreated,
        aggregateType: "group",
        aggregateId: group.id,
        tenantId: group.tenantId,
        payload: { name, parentGroupId: input.parentGroupId },
      }),
    );
    return group;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string {
    return this.props.description;
  }

  get parentGroupId(): Ulid | undefined {
    return this.props.parentGroupId;
  }

  get memberUserIds(): readonly Ulid[] {
    return this.props.memberUserIds;
  }

  get memberCount(): number {
    return this.props.memberUserIds.length;
  }

  get externallyManaged(): boolean {
    return this.props.externallyManaged;
  }

  private assertLocallyManaged(): void {
    if (this.props.externallyManaged) {
      throw new ConflictError(
        `Group ${this.props.name} is managed by an external directory; edit membership there`,
      );
    }
  }

  rename(name: string, description?: string): void {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      throw new ValidationError("Group name is too short", IDENTITY_ERROR.invalidUserState);
    }
    this.props.name = trimmed;
    if (description !== undefined) this.props.description = description.trim();
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.groupRenamed,
        aggregateType: "group",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: trimmed },
      }),
    );
  }

  setParent(parentGroupId: Ulid | undefined): void {
    if (parentGroupId === this.id) {
      throw new ValidationError("A group cannot be its own parent", IDENTITY_ERROR.groupCycle);
    }
    this.props.parentGroupId = parentGroupId;
    this.touch();
  }

  addMember(userId: Ulid, options: { fromDirectory?: boolean } = {}): void {
    if (!options.fromDirectory) this.assertLocallyManaged();
    if (this.props.memberUserIds.includes(userId)) return;
    this.props.memberUserIds = [...this.props.memberUserIds, userId];
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.groupMemberAdded,
        aggregateType: "group",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, userId },
      }),
    );
  }

  removeMember(userId: Ulid, options: { fromDirectory?: boolean } = {}): void {
    if (!options.fromDirectory) this.assertLocallyManaged();
    const next = this.props.memberUserIds.filter((id) => id !== userId);
    if (next.length === this.props.memberUserIds.length) return;
    this.props.memberUserIds = next;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.groupMemberRemoved,
        aggregateType: "group",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, userId },
      }),
    );
  }

  /** Replaces membership wholesale, as an external directory sync would. */
  syncMembers(userIds: readonly Ulid[]): { added: number; removed: number } {
    const before = new Set(this.props.memberUserIds);
    const after = new Set(userIds);
    let added = 0;
    let removed = 0;
    for (const id of after) if (!before.has(id)) added += 1;
    for (const id of before) if (!after.has(id)) removed += 1;
    this.props.memberUserIds = [...after];
    this.touch();
    return { added, removed };
  }

  hasMember(userId: Ulid): boolean {
    return this.props.memberUserIds.includes(userId);
  }
}
