import { ConflictError, NotFoundError, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { IDENTITY_ERROR, IdentityError } from "../domain/errors.js";
import { Group } from "../domain/group.js";
import { wouldCreateGroupCycle } from "./policy/effective-permissions.js";
import type {
  Clock,
  EventPublisher,
  GroupRepository,
  PolicyVersionStore,
  RoleBindingRepository,
  UserRepository,
} from "./ports.js";

export interface CreateGroupInput {
  readonly name: string;
  readonly description?: string;
  readonly parentGroupId?: Ulid;
  readonly externallyManaged?: boolean;
  readonly externalRef?: string;
  readonly memberUserIds?: readonly Ulid[];
}

export class GroupService {
  constructor(
    private readonly groups: GroupRepository,
    private readonly users: UserRepository,
    private readonly bindings: RoleBindingRepository,
    private readonly policyVersions: PolicyVersionStore,
    private readonly clock: Clock,
    private readonly publisher: EventPublisher,
  ) {}

  create(tenantId: TenantId, input: CreateGroupInput): Group {
    if (this.groups.byName(tenantId, input.name.trim())) {
      throw new ConflictError(`Group "${input.name}" already exists`);
    }
    if (input.parentGroupId) this.requireGroup(tenantId, input.parentGroupId);
    const group = Group.create({
      tenantId,
      name: input.name,
      description: input.description,
      parentGroupId: input.parentGroupId,
      externallyManaged: input.externallyManaged,
      externalRef: input.externalRef,
    });
    for (const userId of input.memberUserIds ?? []) {
      this.users.require(tenantId, userId);
      group.addMember(userId, { fromDirectory: true });
    }
    this.persist(tenantId, group);
    return group;
  }

  get(tenantId: TenantId, groupId: Ulid): Group {
    return this.requireGroup(tenantId, groupId);
  }

  list(tenantId: TenantId): readonly Group[] {
    return [...this.groups.list(tenantId)].sort((a, b) => a.name.localeCompare(b.name));
  }

  forUser(tenantId: TenantId, userId: Ulid): readonly Group[] {
    return this.groups.forUser(tenantId, userId);
  }

  rename(tenantId: TenantId, groupId: Ulid, name: string, description?: string): Group {
    const group = this.requireGroup(tenantId, groupId);
    const clash = this.groups.byName(tenantId, name.trim());
    if (clash && clash.id !== groupId) {
      throw new ConflictError(`Group "${name}" already exists`);
    }
    group.rename(name, description);
    this.persist(tenantId, group);
    return group;
  }

  setParent(tenantId: TenantId, groupId: Ulid, parentGroupId: Ulid | undefined): Group {
    const group = this.requireGroup(tenantId, groupId);
    if (parentGroupId) {
      this.requireGroup(tenantId, parentGroupId);
      if (wouldCreateGroupCycle(this.groups.list(tenantId), groupId, parentGroupId)) {
        throw new IdentityError(
          `Setting ${parentGroupId} as parent of ${groupId} would create a cycle`,
          IDENTITY_ERROR.groupCycle,
          409,
        );
      }
    }
    group.setParent(parentGroupId);
    this.persist(tenantId, group);
    return group;
  }

  addMember(tenantId: TenantId, groupId: Ulid, userId: Ulid): Group {
    const group = this.requireGroup(tenantId, groupId);
    this.users.require(tenantId, userId);
    group.addMember(userId);
    this.persist(tenantId, group);
    return group;
  }

  removeMember(tenantId: TenantId, groupId: Ulid, userId: Ulid): Group {
    const group = this.requireGroup(tenantId, groupId);
    group.removeMember(userId);
    this.persist(tenantId, group);
    return group;
  }

  /** Directory sync entry point: membership is replaced wholesale. */
  syncMembers(
    tenantId: TenantId,
    groupId: Ulid,
    userIds: readonly Ulid[],
  ): { group: Group; added: number; removed: number } {
    const group = this.requireGroup(tenantId, groupId);
    for (const userId of userIds) this.users.require(tenantId, userId);
    const delta = group.syncMembers(userIds);
    this.persist(tenantId, group);
    return { group, ...delta };
  }

  /** Deleting a group revokes its bindings so nobody keeps access through a ghost group. */
  delete(tenantId: TenantId, groupId: Ulid, actorId?: Ulid): { revokedBindings: number } {
    const group = this.requireGroup(tenantId, groupId);
    const children = this.groups
      .list(tenantId)
      .filter((candidate) => candidate.parentGroupId === groupId);
    if (children.length > 0) {
      throw new ConflictError(
        `Group ${group.name} still has ${children.length} child group(s); reparent them first`,
      );
    }
    const now = this.clock.now();
    let revoked = 0;
    for (const binding of this.bindings.bySubject(tenantId, { type: "group", id: groupId })) {
      if (!binding.isActiveAt(now)) continue;
      binding.revoke({ at: now, by: actorId, reason: "group_deleted" });
      this.bindings.save(binding);
      this.publisher.publish(binding.pullEvents());
      revoked += 1;
    }
    this.groups.delete(tenantId, groupId);
    this.policyVersions.bump(tenantId);
    return { revokedBindings: revoked };
  }

  private requireGroup(tenantId: TenantId, groupId: Ulid): Group {
    const group = this.groups.byId(tenantId, groupId);
    if (!group) throw new NotFoundError("Group", groupId);
    return group;
  }

  private persist(tenantId: TenantId, group: Group): void {
    this.groups.save(group);
    this.policyVersions.bump(tenantId);
    this.publisher.publish(group.pullEvents());
  }
}
