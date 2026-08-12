import type { Router } from "../router.js";
import { PORTAL_CSS, PORTAL_JS } from "../views/assets.js";

/** In-memory static assets; immutable in production, revalidated in dev. */
export function registerAssetRoutes(router: Router, cacheSeconds = 3600): void {
  const cacheControl = `public, max-age=${cacheSeconds}`;

  router.get("/assets/portal.css", () => ({
    status: 200,
    body: PORTAL_CSS,
    contentType: "text/css; charset=utf-8",
    headers: { "cache-control": cacheControl },
  }));

  router.get("/assets/portal.js", () => ({
    status: 200,
    body: PORTAL_JS,
    contentType: "text/javascript; charset=utf-8",
    headers: { "cache-control": cacheControl },
  }));
}
