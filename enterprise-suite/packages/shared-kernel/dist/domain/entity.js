import { newId, nowIso } from "../types/branded.js";
export class Entity {
    id;
    tenantId;
    createdAt;
    updatedAt;
    version;
    props;
    constructor(tenantId, props, existing) {
        this.id = existing?.id ?? newId(this.constructor.name.toLowerCase());
        this.tenantId = tenantId;
        this.createdAt = existing?.createdAt ?? nowIso();
        this.updatedAt = existing?.updatedAt ?? nowIso();
        this.version = existing?.version ?? 1;
        this.props = props;
    }
    touch() {
        this.updatedAt = nowIso();
        this.version += 1;
    }
    toJSON() {
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
//# sourceMappingURL=entity.js.map