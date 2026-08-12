import type { Ulid } from "@enterprise-suite/shared-kernel";
import { asUlid } from "./ids.js";

/** Anything a role can be bound to. */
export type SubjectType = "user" | "group" | "api_key" | "service";

export const SUBJECT_TYPES: readonly SubjectType[] = ["user", "group", "api_key", "service"];

export interface SubjectRef {
  readonly type: SubjectType;
  readonly id: Ulid;
}

export function subjectRef(type: SubjectType, id: string | Ulid): SubjectRef {
  return { type, id: asUlid(String(id)) };
}

export function userSubject(id: string | Ulid): SubjectRef {
  return subjectRef("user", id);
}

export function groupSubject(id: string | Ulid): SubjectRef {
  return subjectRef("group", id);
}

export function apiKeySubject(id: string | Ulid): SubjectRef {
  return subjectRef("api_key", id);
}

export function serviceSubject(id: string | Ulid): SubjectRef {
  return subjectRef("service", id);
}

/** Stable map key / audit rendering: "user:usr_abc123". */
export function subjectKey(subject: SubjectRef): string {
  return `${subject.type}:${subject.id}`;
}

export function parseSubjectKey(value: string): SubjectRef {
  const index = value.indexOf(":");
  const type = value.slice(0, index) as SubjectType;
  if (index < 0 || !SUBJECT_TYPES.includes(type)) {
    throw new Error(`Invalid subject key "${value}"`);
  }
  return subjectRef(type, value.slice(index + 1));
}

export function sameSubject(a: SubjectRef, b: SubjectRef): boolean {
  return a.type === b.type && a.id === b.id;
}

export function isSubjectType(value: string): value is SubjectType {
  return SUBJECT_TYPES.includes(value as SubjectType);
}
