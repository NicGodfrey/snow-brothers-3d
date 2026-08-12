import { AggregateRoot, DomainError, envelope, } from "@enterprise-suite/shared-kernel";
import { compareDates } from "./common.js";
import { HcmEvents } from "./events.js";
export const TERMINATION_REASONS = [
    "resignation",
    "dismissal",
    "redundancy",
    "retirement",
    "end_of_contract",
    "other",
];
const EMPLOYEE_NUMBER_RE = /^[A-Z0-9][A-Z0-9-]{2,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export class Employee extends AggregateRoot {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static hire(tenantId, input) {
        const employeeNumber = input.employeeNumber.trim().toUpperCase();
        if (!EMPLOYEE_NUMBER_RE.test(employeeNumber)) {
            throw new DomainError(`Employee number must be 3-16 chars of A-Z, 0-9 or '-': got "${input.employeeNumber}"`, "INVALID_EMPLOYEE_NUMBER");
        }
        if (!input.firstName.trim() || !input.lastName.trim()) {
            throw new DomainError("Employee first and last name are required", "INVALID_EMPLOYEE_NAME");
        }
        if (!EMAIL_RE.test(input.email)) {
            throw new DomainError(`Invalid employee email: ${input.email}`, "INVALID_EMAIL");
        }
        const employee = new Employee(tenantId, {
            employeeNumber,
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            email: input.email.trim().toLowerCase(),
            hireDate: input.hireDate,
            status: "active",
            managerEmployeeId: input.managerEmployeeId,
        });
        employee.raise(envelope({
            eventType: HcmEvents.EmployeeHired,
            aggregateType: "Employee",
            aggregateId: employee.id,
            tenantId,
            payload: {
                employeeId: employee.id,
                employeeNumber,
                fullName: employee.fullName,
                hireDate: input.hireDate,
            },
        }));
        return employee;
    }
    get employeeNumber() {
        return this.props.employeeNumber;
    }
    get fullName() {
        return `${this.props.firstName} ${this.props.lastName}`;
    }
    get email() {
        return this.props.email;
    }
    get hireDate() {
        return this.props.hireDate;
    }
    get status() {
        return this.props.status;
    }
    get managerEmployeeId() {
        return this.props.managerEmployeeId;
    }
    get primaryPositionId() {
        return this.props.primaryPositionId;
    }
    get terminationDate() {
        return this.props.terminationDate;
    }
    isEmployed() {
        return this.props.status !== "terminated";
    }
    updateContactInfo(input) {
        this.assertEmployed();
        if (input.firstName !== undefined) {
            if (!input.firstName.trim())
                throw new DomainError("First name cannot be blank", "INVALID_EMPLOYEE_NAME");
            this.props.firstName = input.firstName.trim();
        }
        if (input.lastName !== undefined) {
            if (!input.lastName.trim())
                throw new DomainError("Last name cannot be blank", "INVALID_EMPLOYEE_NAME");
            this.props.lastName = input.lastName.trim();
        }
        if (input.email !== undefined) {
            if (!EMAIL_RE.test(input.email))
                throw new DomainError(`Invalid email: ${input.email}`, "INVALID_EMAIL");
            this.props.email = input.email.trim().toLowerCase();
        }
        this.touch();
    }
    /** Manager existence/active checks belong to EmployeeService; local rule: no self-management. */
    changeManager(managerEmployeeId) {
        this.assertEmployed();
        if (managerEmployeeId === this.id) {
            throw new DomainError("An employee cannot be their own manager", "SELF_MANAGER");
        }
        const previousManagerId = this.props.managerEmployeeId;
        this.props.managerEmployeeId = managerEmployeeId;
        this.raise(envelope({
            eventType: HcmEvents.EmployeeManagerChanged,
            aggregateType: "Employee",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { employeeId: this.id, previousManagerId, newManagerId: managerEmployeeId },
        }));
    }
    assignPrimaryPosition(positionId) {
        this.assertEmployed();
        this.props.primaryPositionId = positionId;
        this.touch();
    }
    clearPrimaryPosition() {
        this.props.primaryPositionId = undefined;
        this.touch();
    }
    placeOnLeave() {
        if (this.props.status !== "active") {
            throw new DomainError(`Only active employees can be placed on leave (status: ${this.props.status})`, "INVALID_STATUS_TRANSITION", 409);
        }
        this.props.status = "on_leave";
        this.raise(envelope({
            eventType: HcmEvents.EmployeePlacedOnLeave,
            aggregateType: "Employee",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { employeeId: this.id },
        }));
    }
    returnFromLeave() {
        if (this.props.status !== "on_leave") {
            throw new DomainError(`Employee is not on leave (status: ${this.props.status})`, "INVALID_STATUS_TRANSITION", 409);
        }
        this.props.status = "active";
        this.raise(envelope({
            eventType: HcmEvents.EmployeeReturnedFromLeave,
            aggregateType: "Employee",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { employeeId: this.id },
        }));
    }
    suspend(reason) {
        if (this.props.status !== "active" && this.props.status !== "on_leave") {
            throw new DomainError(`Cannot suspend employee from status ${this.props.status}`, "INVALID_STATUS_TRANSITION", 409);
        }
        this.props.status = "suspended";
        this.raise(envelope({
            eventType: HcmEvents.EmployeeSuspended,
            aggregateType: "Employee",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { employeeId: this.id, reason },
        }));
    }
    reinstate() {
        if (this.props.status !== "suspended") {
            throw new DomainError(`Employee is not suspended (status: ${this.props.status})`, "INVALID_STATUS_TRANSITION", 409);
        }
        this.props.status = "active";
        this.raise(envelope({
            eventType: HcmEvents.EmployeeReinstated,
            aggregateType: "Employee",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { employeeId: this.id },
        }));
    }
    terminate(input) {
        if (this.props.status === "terminated") {
            throw new DomainError("Employee is already terminated", "ALREADY_TERMINATED", 409);
        }
        if (!TERMINATION_REASONS.includes(input.reason)) {
            throw new DomainError(`Unknown termination reason "${input.reason}"`, "INVALID_TERMINATION_REASON");
        }
        if (compareDates(input.terminationDate, this.props.hireDate) < 0) {
            throw new DomainError(`Termination date ${input.terminationDate} precedes hire date ${this.props.hireDate}`, "INVALID_TERMINATION_DATE");
        }
        this.props.status = "terminated";
        this.props.terminationDate = input.terminationDate;
        this.props.terminationReason = input.reason;
        this.props.rehireEligible = input.rehireEligible;
        this.raise(envelope({
            eventType: HcmEvents.EmployeeTerminated,
            aggregateType: "Employee",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: {
                employeeId: this.id,
                terminationDate: input.terminationDate,
                reason: input.reason,
                rehireEligible: input.rehireEligible,
            },
        }));
    }
    assertEmployed() {
        if (this.props.status === "terminated") {
            throw new DomainError(`Employee ${this.props.employeeNumber} is terminated`, "EMPLOYEE_TERMINATED", 409);
        }
    }
}
//# sourceMappingURL=employee.js.map