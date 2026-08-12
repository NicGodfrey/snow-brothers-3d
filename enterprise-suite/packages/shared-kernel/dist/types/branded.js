export function brand(value) {
    return value;
}
export function nowIso() {
    return brand(new Date().toISOString());
}
export function newId(prefix = "id") {
    const rand = Math.random().toString(36).slice(2, 10);
    const time = Date.now().toString(36);
    return brand(`${prefix}_${time}${rand}`);
}
//# sourceMappingURL=branded.js.map