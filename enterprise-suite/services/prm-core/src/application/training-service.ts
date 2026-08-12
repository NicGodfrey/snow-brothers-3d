import {
  ConflictError,
  NotFoundError,
  normalizePage,
  type IsoDateTime,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  Certification,
  summarizeCertifications,
  type PartnerCertificationSummary,
} from "../domain/certification.js";
import { isAfter } from "../domain/dates.js";
import { CertificationRequirementsError, InvalidStateError, ValidationError } from "../domain/errors.js";
import {
  Enrollment,
  createCertificationDefinition,
  createCourse,
  type CertificationDefinition,
  type Course,
  type CreateCertificationDefinitionInput,
  type CreateCourseInput,
  type ExamAttempt,
} from "../domain/training.js";
import type {
  CertificationDefinitionRepository,
  CertificationFilter,
  CertificationRepository,
  Clock,
  CourseRepository,
  EnrollmentFilter,
  EnrollmentRepository,
  OutboxPort,
  PortalUserRepository,
} from "./ports.js";

export interface EnrollCommand {
  readonly portalUserId: Ulid;
  readonly courseCode: string;
}

export interface UserTranscript {
  readonly portalUserId: Ulid;
  readonly partnerId: Ulid;
  readonly completedCourseCodes: readonly string[];
  readonly inProgressCourseCodes: readonly string[];
  readonly certifications: readonly {
    readonly code: string;
    readonly status: string;
    readonly awardedAt: IsoDateTime;
    readonly expiresAt: IsoDateTime;
    readonly daysUntilExpiry: number;
  }[];
}

/**
 * Enablement use cases: catalog administration, enrollments and the
 * certification lifecycle.
 *
 * The interesting rules are the ones that span records: a course cannot list
 * a prerequisite that does not exist, an individual cannot enroll before
 * completing prerequisites, a certification is only awarded when every
 * required course is *completed by that person*, and a renewal only counts
 * recertification courses completed since the last award.
 */
export class TrainingService {
  constructor(
    private readonly courses: CourseRepository,
    private readonly definitions: CertificationDefinitionRepository,
    private readonly enrollments: EnrollmentRepository,
    private readonly certifications: CertificationRepository,
    private readonly portalUsers: PortalUserRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  // --- catalog ---------------------------------------------------------------

  async createCourse(ctx: TenantContext, input: CreateCourseInput): Promise<Course> {
    const existing = await this.courses.byCode(ctx.tenantId, input.code);
    if (existing) throw new ConflictError(`Course "${existing.code}" already exists`);
    const course = createCourse(ctx.tenantId, input);
    for (const prerequisite of course.prerequisiteCourseCodes) {
      const found = await this.courses.byCode(ctx.tenantId, prerequisite);
      if (!found) throw new NotFoundError("Course", prerequisite);
    }
    await this.courses.save(course);
    return course;
  }

  async listCourses(ctx: TenantContext): Promise<readonly Course[]> {
    return this.courses.all(ctx.tenantId);
  }

  async getCourse(ctx: TenantContext, code: string): Promise<Course> {
    const course = await this.courses.byCode(ctx.tenantId, code);
    if (!course) throw new NotFoundError("Course", code);
    return course;
  }

  /** Retires a course: existing enrollments finish, new ones are refused. */
  async retireCourse(ctx: TenantContext, code: string): Promise<Course> {
    const course = await this.getCourse(ctx, code);
    const dependents = (await this.definitions.all(ctx.tenantId)).filter(
      (d) => d.active && d.requiredCourseCodes.includes(course.code),
    );
    if (dependents.length > 0) {
      throw new InvalidStateError(
        `Course ${course.code} is required by ${dependents.map((d) => d.code).join(", ")}`,
      );
    }
    const retired: Course = { ...course, active: false, updatedAt: this.clock.now() };
    await this.courses.save(retired);
    return retired;
  }

  async createCertificationDefinition(
    ctx: TenantContext,
    input: CreateCertificationDefinitionInput,
  ): Promise<CertificationDefinition> {
    const existing = await this.definitions.byCode(ctx.tenantId, input.code);
    if (existing) throw new ConflictError(`Certification "${existing.code}" already exists`);
    const definition = createCertificationDefinition(ctx.tenantId, input);
    for (const code of new Set([...definition.requiredCourseCodes, ...definition.renewalCourseCodes])) {
      const course = await this.courses.byCode(ctx.tenantId, code);
      if (!course) throw new NotFoundError("Course", code);
    }
    await this.definitions.save(definition);
    return definition;
  }

  async listCertificationDefinitions(ctx: TenantContext): Promise<readonly CertificationDefinition[]> {
    return this.definitions.all(ctx.tenantId);
  }

  async getCertificationDefinition(ctx: TenantContext, code: string): Promise<CertificationDefinition> {
    const definition = await this.definitions.byCode(ctx.tenantId, code);
    if (!definition) throw new NotFoundError("CertificationDefinition", code);
    return definition;
  }

  // --- enrollments -----------------------------------------------------------

  async enroll(ctx: TenantContext, command: EnrollCommand): Promise<Enrollment> {
    const user = await this.portalUsers.byId(ctx.tenantId, command.portalUserId);
    if (!user) throw new NotFoundError("PortalUser", command.portalUserId);
    if (user.status === "disabled") {
      throw new InvalidStateError(`${user.email} is disabled and cannot be enrolled`);
    }
    const course = await this.getCourse(ctx, command.courseCode);
    const open = await this.enrollments.activeForUserAndCourse(ctx.tenantId, user.id, course.code);
    if (open) {
      throw new ConflictError(`${user.email} is already enrolled in ${course.code} (${open.status})`);
    }
    const missing = await this.missingPrerequisites(ctx, user.id, course);
    if (missing.length > 0) {
      throw new ValidationError(`Prerequisites for ${course.code} are not met`, [
        { field: "prerequisites", message: `complete ${missing.join(", ")} first` },
      ]);
    }
    const enrollment = Enrollment.create(ctx.tenantId, {
      partnerId: user.partnerId,
      portalUserId: user.id,
      course,
      at: this.clock.now(),
    });
    await this.commitEnrollment(enrollment);
    return enrollment;
  }

  async getEnrollment(ctx: TenantContext, id: Ulid): Promise<Enrollment> {
    const enrollment = await this.enrollments.byId(ctx.tenantId, id);
    if (!enrollment) throw new NotFoundError("Enrollment", id);
    return enrollment;
  }

  async listEnrollments(
    ctx: TenantContext,
    filter: EnrollmentFilter,
    page?: Partial<PageRequest>,
  ): Promise<Page<Enrollment>> {
    return this.enrollments.list(ctx.tenantId, filter, normalizePage(page));
  }

  async startEnrollment(ctx: TenantContext, id: Ulid): Promise<Enrollment> {
    const enrollment = await this.getEnrollment(ctx, id);
    enrollment.start(this.clock.now());
    await this.commitEnrollment(enrollment);
    return enrollment;
  }

  async recordAttempt(
    ctx: TenantContext,
    id: Ulid,
    input: { readonly score: number; readonly proctored?: boolean },
  ): Promise<ExamAttempt> {
    const enrollment = await this.getEnrollment(ctx, id);
    const attempt = enrollment.recordAttempt({ ...input, at: this.clock.now() });
    await this.commitEnrollment(enrollment);
    return attempt;
  }

  async resetAttempts(ctx: TenantContext, id: Ulid, reason: string): Promise<Enrollment> {
    const enrollment = await this.getEnrollment(ctx, id);
    enrollment.resetAttempts(reason, ctx.userId);
    await this.commitEnrollment(enrollment);
    return enrollment;
  }

  async withdraw(ctx: TenantContext, id: Ulid, reason: string): Promise<Enrollment> {
    const enrollment = await this.getEnrollment(ctx, id);
    enrollment.withdraw(reason);
    await this.commitEnrollment(enrollment);
    return enrollment;
  }

  // --- certifications --------------------------------------------------------

  /** Awards a certification once every required course is completed. */
  async award(
    ctx: TenantContext,
    input: { readonly portalUserId: Ulid; readonly certificationCode: string },
  ): Promise<Certification> {
    const user = await this.portalUsers.byId(ctx.tenantId, input.portalUserId);
    if (!user) throw new NotFoundError("PortalUser", input.portalUserId);
    const definition = await this.getCertificationDefinition(ctx, input.certificationCode);
    if (!definition.active) {
      throw new InvalidStateError(`Certification ${definition.code} is not offered any more`);
    }
    const existing = await this.certifications.forUserAndCode(ctx.tenantId, user.id, definition.code);
    const now = this.clock.now();
    if (existing && existing.isActiveAt(now)) {
      throw new ConflictError(`${user.email} already holds ${definition.code} until ${existing.expiresAt}`);
    }

    const completions = await this.completedEnrollments(ctx, user.id);
    const missing = definition.requiredCourseCodes.filter((code) => !completions.has(code));
    if (missing.length > 0) throw new CertificationRequirementsError(definition.code, missing);

    const certification = Certification.award(ctx.tenantId, {
      certificationCode: definition.code,
      level: definition.level,
      partnerId: user.partnerId,
      portalUserId: user.id,
      at: now,
      by: ctx.userId,
      validityMonths: definition.validityMonths,
      evidenceEnrollmentIds: definition.requiredCourseCodes.map((code) => completions.get(code)!.id),
    });
    await this.commitCertification(certification);
    return certification;
  }

  /**
   * Renews a held certification. Recertification courses must have been
   * completed *since* the current validity period started, so an old
   * completion cannot be recycled into a new term.
   */
  async renew(ctx: TenantContext, certificationId: Ulid): Promise<Certification> {
    const certification = await this.getCertification(ctx, certificationId);
    const definition = await this.getCertificationDefinition(ctx, certification.certificationCode);
    const since =
      certification.renewals.length > 0
        ? certification.renewals[certification.renewals.length - 1]!.renewedAt
        : certification.awardedAt;

    const completions = await this.completedEnrollments(ctx, certification.portalUserId);
    const evidence: Ulid[] = [];
    const missing: string[] = [];
    for (const code of definition.renewalCourseCodes) {
      const enrollment = completions.get(code);
      if (!enrollment || !enrollment.completedAt || !isAfter(enrollment.completedAt, since)) {
        missing.push(`${code} (completed after ${since})`);
      } else {
        evidence.push(enrollment.id);
      }
    }
    if (missing.length > 0) throw new CertificationRequirementsError(definition.code, missing);

    certification.renew({
      at: this.clock.now(),
      by: ctx.userId,
      validityMonths: definition.validityMonths,
      renewalWindowDays: definition.renewalWindowDays,
      evidenceEnrollmentIds: evidence,
    });
    await this.commitCertification(certification);
    return certification;
  }

  async revoke(ctx: TenantContext, certificationId: Ulid, reason: string): Promise<Certification> {
    const certification = await this.getCertification(ctx, certificationId);
    certification.revoke({ at: this.clock.now(), by: ctx.userId, reason });
    await this.commitCertification(certification);
    return certification;
  }

  async getCertification(ctx: TenantContext, id: Ulid): Promise<Certification> {
    const certification = await this.certifications.byId(ctx.tenantId, id);
    if (!certification) throw new NotFoundError("Certification", id);
    return certification;
  }

  async listCertifications(
    ctx: TenantContext,
    filter: CertificationFilter,
    page?: Partial<PageRequest>,
  ): Promise<Page<Certification>> {
    return this.certifications.list(ctx.tenantId, filter, normalizePage(page));
  }

  /** Sweeps validity: everything past its expiry flips to expired. */
  async expireDue(ctx: TenantContext, at?: IsoDateTime): Promise<readonly Ulid[]> {
    const now = at ?? this.clock.now();
    const expired: Ulid[] = [];
    for (const certification of await this.certifications.all(ctx.tenantId)) {
      if (certification.expireIfDue(now)) {
        await this.commitCertification(certification);
        expired.push(certification.id);
      }
    }
    return expired;
  }

  async partnerSummary(ctx: TenantContext, partnerId: Ulid): Promise<PartnerCertificationSummary> {
    const certifications = await this.certifications.byPartner(ctx.tenantId, partnerId);
    return summarizeCertifications(partnerId, certifications, this.clock.now());
  }

  async transcript(ctx: TenantContext, portalUserId: Ulid): Promise<UserTranscript> {
    const user = await this.portalUsers.byId(ctx.tenantId, portalUserId);
    if (!user) throw new NotFoundError("PortalUser", portalUserId);
    const enrollments = await this.enrollments.byUser(ctx.tenantId, portalUserId);
    const certifications = await this.certifications.byUser(ctx.tenantId, portalUserId);
    const now = this.clock.now();
    return {
      portalUserId,
      partnerId: user.partnerId,
      completedCourseCodes: enrollments.filter((e) => e.isComplete()).map((e) => e.courseCode).sort(),
      inProgressCourseCodes: enrollments
        .filter((e) => e.status === "enrolled" || e.status === "in_progress")
        .map((e) => e.courseCode)
        .sort(),
      certifications: certifications.map((c) => ({
        code: c.certificationCode,
        status: c.status,
        awardedAt: c.awardedAt,
        expiresAt: c.expiresAt,
        daysUntilExpiry: c.daysUntilExpiry(now),
      })),
    };
  }

  // --- internals -------------------------------------------------------------

  private async completedEnrollments(ctx: TenantContext, portalUserId: Ulid): Promise<Map<string, Enrollment>> {
    const enrollments = await this.enrollments.byUser(ctx.tenantId, portalUserId);
    const completed = new Map<string, Enrollment>();
    for (const enrollment of enrollments) {
      if (!enrollment.isComplete()) continue;
      const previous = completed.get(enrollment.courseCode);
      // Keep the most recent completion: it is what a renewal window is judged on.
      if (!previous || (enrollment.completedAt && previous.completedAt && isAfter(enrollment.completedAt, previous.completedAt))) {
        completed.set(enrollment.courseCode, enrollment);
      }
    }
    return completed;
  }

  private async missingPrerequisites(
    ctx: TenantContext,
    portalUserId: Ulid,
    course: Course,
  ): Promise<readonly string[]> {
    if (course.prerequisiteCourseCodes.length === 0) return [];
    const completed = await this.completedEnrollments(ctx, portalUserId);
    return course.prerequisiteCourseCodes.filter((code) => !completed.has(code));
  }

  private async commitEnrollment(enrollment: Enrollment): Promise<void> {
    await this.enrollments.save(enrollment);
    await this.outbox.publish(enrollment.pullEvents());
  }

  private async commitCertification(certification: Certification): Promise<void> {
    await this.certifications.save(certification);
    await this.outbox.publish(certification.pullEvents());
  }
}
