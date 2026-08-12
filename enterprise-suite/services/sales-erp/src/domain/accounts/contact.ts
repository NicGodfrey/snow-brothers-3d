import { Entity } from "../../kernel/entity.js";
import type { Email, TenantId, Ulid } from "../../kernel/index.js";

export type ContactRole = "decision_maker" | "influencer" | "billing" | "technical" | "other";

export interface ContactProps {
  accountId: Ulid;
  firstName: string;
  lastName: string;
  email: Email;
  phone?: string;
  role: ContactRole;
  isPrimary: boolean;
  active: boolean;
}

export class Contact extends Entity<ContactProps> {
  private constructor(tenantId: TenantId, props: ContactProps) {
    super(tenantId, props);
  }

  static create(
    tenantId: TenantId,
    input: {
      accountId: Ulid;
      firstName: string;
      lastName: string;
      email: Email;
      phone?: string;
      role?: ContactRole;
      isPrimary?: boolean;
    },
  ): Contact {
    return new Contact(tenantId, {
      accountId: input.accountId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email,
      phone: input.phone,
      role: input.role ?? "other",
      isPrimary: input.isPrimary ?? false,
      active: true,
    });
  }

  get accountId(): Ulid {
    return this.props.accountId;
  }

  get fullName(): string {
    return `${this.props.firstName} ${this.props.lastName}`;
  }

  get isPrimary(): boolean {
    return this.props.isPrimary;
  }

  get active(): boolean {
    return this.props.active;
  }

  markPrimary(): void {
    this.props.isPrimary = true;
    this.touch();
  }

  clearPrimary(): void {
    this.props.isPrimary = false;
    this.touch();
  }

  deactivate(): void {
    this.props.active = false;
    this.props.isPrimary = false;
    this.touch();
  }
}
