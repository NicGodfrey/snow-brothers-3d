import { createServer } from "node:http";
import { buildHcmRouter } from "./app.js";
import { errorToResponse } from "./router.js";
const MAX_BODY_BYTES = 1_048_576; // 1 MiB
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        req.on("data", (chunk) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                reject(new Error("Request body exceeds 1 MiB limit"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}
async function handle(router, req, res) {
    let response;
    try {
        const raw = await readBody(req);
        const body = raw.length > 0 ? JSON.parse(raw) : undefined;
        response = await router.dispatch({
            method: req.method ?? "GET",
            url: req.url ?? "/",
            headers: req.headers,
            body,
        });
    }
    catch (error) {
        response = errorToResponse(error);
    }
    const payload = JSON.stringify(response.body ?? null);
    res.writeHead(response.status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
}
/** Node HTTP server wrapping the HCM router. Caller owns listen/close. */
export function createHcmServer(module) {
    const router = buildHcmRouter(module);
    return createServer((req, res) => {
        void handle(router, req, res);
    });
}
//# sourceMappingURL=server.js.map