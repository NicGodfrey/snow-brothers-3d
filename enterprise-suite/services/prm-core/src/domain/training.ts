import {
  AggregateRoot,
  envelope,
  newId,
  nowIso,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { parseIso } from "./dates.js";
import { InvalidStateError, ValidationError } from "./errors.js";
import { PrmEventTypes } from "./events.js";

/**
 * Partner enablement: the course catalog, the certifications those courses
 * lead to, and one partner individual's progress through a course.
 *
 * Courses and certification definitions are catalog *records* (program design
 * data). An Enrollment is an aggregate because it has a life of its own —
 * attempts, a pass/fail decision and an attempt budget that an administrator
 * can reset.
 */

export type TrainingTrack = "sales" | "presales" | "technical" | "support" | "marketing" | "compliance";

export const TRAINING_TRACKS: readonly TrainingTrack[] = [
  "sales",
  "presales",
  "technical",
  "support",
  "marketing",
  "compliance",
];

export type DeliveryMode = "self_paced" | "virtual_classroom" | "in_person" | "lab";

export const DELIVERY_MODES: readonly DeliveryMode[] = ["self_paced", "virtual_classroom", "in_person", "lab"];

export type CertificationLevel = "associate" | "professional" | "expert";

export const CERTIFICATION_LEVELS: readonly CertificationLevel[] = ["associate", "professional", "expert"];

export interface Course {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  readonly code: string;
  readonly title: string;
  readonly description?: string;
  readonly track: TrainingTrack;
  readonly deliveryMode: DeliveryMode;
  readonly durationMinutes: number;
  /** Score out of 100 needed to pass the course exam. */
  readonly passingScore: number;
  readonly maxAttempts: number;
  readonly prerequisiteCourseCodes: readonly string[];
  readonly version: number;
  readonly active: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface CreateCourseInput {
  readonly code: string;
  readonly title: string;
  readonly description?: string;
  readonly track: TrainingTrack;
  readonly deliveryMode: DeliveryMode;
  readonly durationMinutes: number;
  readonly passingScore?: number;
  readonly maxAttempts?: number;
  readonly prerequisiteCourseCodes?: readonly string[];
}

const CATALOG_CODE = /^[a-z0-9][a-z0-9_-]{1,40}$/;

function normalizeCode(value: string, field: string): string {
  const code = value.trim().toLowerCase();
  if (!CATALOG_CODE.test(code)) {
    throw ValidationError.single(field, "must be a lowercase code (letters, digits, - or _)");
  }
  return code;
}

export function createCourse(tenantId: TenantId, input: CreateCourseInput): Course {
  const code = normalizeCode(input.code, "code");
  if (input.title.trim().length === 0) throw ValidationError.single("title", "is required");
  if (!TRAINING_TRACKS.includes(input.track)) {
    throw ValidationError.single("track", `must be one of [${TRAINING_TRACKS.join(", ")}]`);
  }
  if (!DELIVERY_MODES.includes(input.deliveryMode)) {
    throw ValidationError.single("deliveryMode", `must be one of [${DELIVERY_MODES.join(", ")}]`);
  }
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 10_000) {
    throw ValidationError.single("durationMinutes", "must be an integer between 5 and 10000");
  }
  const passingScore = input.passingScore ?? 70;
  if (!Number.isInteger(passingScore) || passingScore < 1 || passingScore > 100) {
    throw ValidationError.single("passingScore", "must be an integer between 1 and 100");
  }
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw ValidationError.single("maxAttempts", "must be an integer between 1 and 10");
  }
  const prerequisites = [...new Set((input.prerequisiteCourseCodes ?? []).map((c) => normalizeCode(c, "prerequisiteCourseCodes")))];
  if (prerequisites.includes(code)) {
    throw ValidationError.single("prerequisiteCourseCodes", "a course cannot require itself");
  }
  const now = nowIso();
  return {
    id: newId("course"),
    tenantId,
    code,
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    track: input.track,
    deliveryMode: input.deliveryMode,
    durationMinutes: input.durationMinutes,
    passingScore,
    maxAttempts,
    prerequisiteCourseCodes: prerequisites,
    version: 1,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

export interface CertificationDefinition {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  readonly code: string;
  readonly name: string;
  readonly track: TrainingTrack;
  readonly level: CertificationLevel;
  readonly requiredCourseCodes: readonly string[];
  /** Courses that must be retaken to renew; defaults to the required set. */
  readonly renewalCourseCodes: readonly string[];
  readonly validityMonths: number;
  /** How early a holder may renew before expiry. */
  readonly renewalWindowDays: number;
  readonly active: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface CreateCertificationDefinitionInput {
  readonly code: string;
  readonly name: string;
  readonly track: TrainingTrack;
  readonly level: CertificationLevel;
  readonly requiredCourseCodes: readonly string[];
  readonly renewalCourseCodes?: readonly string[];
  readonly validityMonths?: number;
  readonly renewalWindowDays?: number;
}

export function createCertificationDefinition(
  tenantId: TenantId,
  input: CreateCertificationDefinitionInput,
): CertificationDefinition {
  const code = normalizeCode(input.code, "code");
  if (input.name.trim().length === 0) throw ValidationError.single("name", "is required");
  if (!TRAINING_TRACKS.includes(input.track)) {
    throw ValidationError.single("track", `must be one of [${TRAINING_TRACKS.join(", ")}]`);
  }
  if (!CERTIFICATION_LEVELS.includes(input.level)) {
    throw ValidationError.single("level", `must be one of [${CERTIFICATION_LEVELS.join(", ")}]`);
  }
  const required = [...new Set(input.requiredCourseCodes.map((c) => normalizeCode(c, "requiredCourseCodes")))];
  if (required.length === 0) {
    throw ValidationError.single("requiredCourseCodes", "at least one course is required");
  }
  const renewal = input.renewalCourseCodes
    ? [...new Set(input.renewalCourseCodes.map((c) => normalizeCode(c, "renewalCourseCodes")))]
    : required;
  const validityMonths = input.validityMonths ?? 24;
  if (!Number.isInteger(validityMonths) || validityMonths < 1 || validityMonths > 120) {
    throw ValidationError.single("validityMonths", "must be an integer between 1 and 120");
  }
  const renewalWindowDays = input.renewalWindowDays ?? 90;
  if (!Number.isInteger(renewalWindowDays) || renewalWindowDays < 0 || renewalWindowDays > 365) {
    throw ValidationError.single("renewalWindowDays", "must be an integer between 0 and 365");
  }
  const now = nowIso();
  return {
    id: newId("certdef"),
    tenantId,
    code,
    name: input.name.trim(),
    track: input.track,
    level: input.level,
    requiredCourseCodes: required,
    renewalCourseCodes: renewal,
    validityMonths,
    renewalWindowDays,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

export type EnrollmentStatus = "enrolled" | "in_progress" | "completed" | "failed" | "withdrawn";

export const ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = [
  "enrolled",
  "in_progress",
  "completed",
  "failed",
  "withdrawn",
];

export interface ExamAttempt {
  readonly attempt: number;
  readonly score: number;
  readonly passed: boolean;
  readonly takenAt: IsoDateTime;
  readonly proctored: boolean;
}

export interface EnrollmentProps {
  partnerId: Ulid;
  portalUserId: Ulid;
  courseCode: string;
  courseVersion: number;
  passingScore: number;
  maxAttempts: number;
  status: EnrollmentStatus;
  attempts: ExamAttempt[];
  enrolledAt: IsoDateTime;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  bestScore?: number;
  withdrawnReason?: string;
  attemptResets: number;
}

export interface CreateEnrollmentInput {
  readonly partnerId: Ulid;
  readonly portalUserId: Ulid;
  readonly course: Course;
  readonly at: IsoDateTime;
}

export class Enrollment extends AggregateRoot<EnrollmentProps> {
  static create(tenantId: TenantId, input: CreateEnrollmentInput): Enrollment {
    if (!input.course.active) {
      throw new InvalidStateError(`Course ${input.course.code} is retired and cannot be enrolled in`);
    }
    const enrollment = new Enrollment(tenantId, {
      partnerId: input.partnerId,
      portalUserId: input.portalUserId,
      courseCode: input.course.code,
      courseVersion: input.course.version,
      passingScore: input.course.passingScore,
      maxAttempts: input.course.maxAttempts,
      status: "enrolled",
      attempts: [],
      enrolledAt: parseIso(input.at, "at"),
      attemptResets: 0,
    });
    enrollment.raise(enrollment.enrollmentEvent(PrmEventTypes.EnrollmentCreated));
    return enrollment;
  }

  static fromSnapshot(snapshot: EntityProps & EnrollmentProps): Enrollment {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Enrollment(
      tenantId,
      { ...props, attempts: [...props.attempts] },
      { id, createdAt, updatedAt, version },
    );
  }

  get partnerId(): Ulid {
    return this.props.partnerId;
  }
  get portalUserId(): Ulid {
    return this.props.portalUserId;
  }
  get courseCode(): string {
    return this.props.courseCode;
  }
  get status(): EnrollmentStatus {
    return this.props.status;
  }
  get attempts(): readonly ExamAttempt[] {
    return this.props.attempts;
  }
  get bestScore(): number | undefined {
    return this.props.bestScore;
  }
  get completedAt(): IsoDateTime | undefined {
    return this.props.completedAt;
  }
  get attemptsRemaining(): number {
    return Math.max(0, this.props.maxAttempts - this.props.attempts.length);
  }

  isComplete(): boolean {
    return this.props.status === "completed";
  }

  start(at: IsoDateTime): void {
    if (this.props.status !== "enrolled") {
      throw new InvalidStateError(`Enrollment in ${this.props.courseCode} is ${this.props.status}`);
    }
    this.props.status = "in_progress";
    this.props.startedAt = parseIso(at, "at");
    this.touch();
  }

  /**
   * Records an exam attempt. Passing completes the enrollment; burning the
   * last attempt fails it, and only an administrator reset reopens it.
   */
  recordAttempt(input: { readonly score: number; readonly at: IsoDateTime; readonly proctored?: boolean }): ExamAttempt {
    if (this.props.status !== "enrolled" && this.props.status !== "in_progress") {
      throw new InvalidStateError(
        `Cannot record an attempt: enrollment in ${this.props.courseCode} is ${this.props.status}`,
      );
    }
    if (!Number.isInteger(input.score) || input.score < 0 || input.score > 100) {
      throw ValidationError.single("score", "must be an integer between 0 and 100");
    }
    if (this.attemptsRemaining === 0) {
      throw new InvalidStateError(`All ${this.props.maxAttempts} attempts for ${this.props.courseCode} are used`);
    }
    const passed = input.score >= this.props.passingScore;
    const attempt: ExamAttempt = {
      attempt: this.props.attempts.length + 1,
      score: input.score,
      passed,
      takenAt: parseIso(input.at, "at"),
      proctored: input.proctored ?? false,
    };
    this.props.attempts.push(attempt);
    this.props.bestScore = Math.max(this.props.bestScore ?? 0, input.score);
    this.props.status = passed ? "completed" : this.attemptsRemaining === 0 ? "failed" : "in_progress";
    if (passed) this.props.completedAt = attempt.takenAt;

    this.raise(
      envelope({
        eventType: PrmEventTypes.EnrollmentAttemptRecorded,
        aggregateType: "Enrollment",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          enrollmentId: this.id,
          partnerId: this.props.partnerId,
          portalUserId: this.props.portalUserId,
          courseCode: this.props.courseCode,
          attempt: attempt.attempt,
          score: attempt.score,
          passed,
          attemptsRemaining: this.attemptsRemaining,
        },
      }),
    );
    if (this.props.status === "completed") {
      this.raise(this.enrollmentEvent(PrmEventTypes.EnrollmentCompleted));
    } else if (this.props.status === "failed") {
      this.raise(this.enrollmentEvent(PrmEventTypes.EnrollmentFailed));
    }
    return attempt;
  }

  /** Grants a fresh attempt budget after a failure (training manager action). */
  resetAttempts(reason: string, by: UserId): void {
    if (this.props.status !== "failed") {
      throw new InvalidStateError(`Only failed enrollments can be reset (${this.props.status})`);
    }
    if (reason.trim().length === 0) throw ValidationError.single("reason", "is required");
    this.props.attempts = [];
    this.props.status = "in_progress";
    this.props.attemptResets += 1;
    this.raise(
      envelope({
        eventType: PrmEventTypes.EnrollmentAttemptRecorded,
        aggregateType: "Enrollment",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          enrollmentId: this.id,
          partnerId: this.props.partnerId,
          portalUserId: this.props.portalUserId,
          courseCode: this.props.courseCode,
          attempt: 0,
          score: 0,
          passed: false,
          attemptsRemaining: this.props.maxAttempts,
          reset: true,
          reason: reason.trim(),
          resetBy: by,
        },
      }),
    );
  }

  withdraw(reason: string): void {
    if (this.props.status === "completed" || this.props.status === "withdrawn") {
      throw new InvalidStateError(`Enrollment in ${this.props.courseCode} is ${this.props.status}`);
    }
    this.props.status = "withdrawn";
    this.props.withdrawnReason = reason.trim() || "withdrawn";
    this.raise(this.enrollmentEvent(PrmEventTypes.EnrollmentWithdrawn));
  }

  private enrollmentEvent(eventType: string) {
    return envelope({
      eventType,
      aggregateType: "Enrollment",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: {
        enrollmentId: this.id,
        partnerId: this.props.partnerId,
        portalUserId: this.props.portalUserId,
        courseCode: this.props.courseCode,
      },
    });
  }
}
