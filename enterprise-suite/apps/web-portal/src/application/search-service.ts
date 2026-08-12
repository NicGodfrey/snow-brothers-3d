import type { ApiClients } from "../api/index.js";
import type { SearchHit } from "../api/module-api.js";
import type { ModuleKey } from "../domain/module.js";
import { visibleModules } from "../domain/navigation.js";
import type { PortalSession } from "../domain/session.js";

/**
 * Cross-module search behind the command palette. Queries every visible module
 * in parallel, keeps whatever answers in time, and reports the ones that did
 * not instead of failing the whole search.
 */

export interface SearchGroup {
  readonly module: ModuleKey;
  readonly label: string;
  readonly hits: readonly SearchHit[];
}

export interface SearchResult {
  readonly term: string;
  readonly groups: readonly SearchGroup[];
  readonly totalHits: number;
  readonly unavailableModules: readonly ModuleKey[];
  readonly truncated: boolean;
}

export interface SearchOptions {
  readonly perModuleLimit?: number;
  readonly totalLimit?: number;
  readonly timeoutMs?: number;
  readonly modules?: readonly ModuleKey[];
}

export const MIN_SEARCH_LENGTH = 2;

export class SearchService {
  constructor(private readonly clients: ApiClients) {}

  async search(
    session: PortalSession,
    term: string,
    options: SearchOptions = {},
  ): Promise<SearchResult> {
    const trimmed = term.trim();
    if (trimmed.length < MIN_SEARCH_LENGTH) {
      return { term: trimmed, groups: [], totalHits: 0, unavailableModules: [], truncated: false };
    }

    const perModuleLimit = options.perModuleLimit ?? 5;
    const totalLimit = options.totalLimit ?? 25;
    const modules = visibleModules(session).filter(
      (m) => !options.modules || options.modules.includes(m.key),
    );

    const settled = await Promise.all(
      modules.map(async (module) => {
        try {
          const hits = await this.clients.byModule[module.key].search(
            trimmed,
            perModuleLimit,
            options.timeoutMs ? { timeoutMs: options.timeoutMs, retries: 0 } : { retries: 0 },
          );
          return { module, hits, failed: false as const };
        } catch {
          // A module that cannot answer must not sink the palette.
          return { module, hits: [] as readonly SearchHit[], failed: true as const };
        }
      }),
    );

    const groups: SearchGroup[] = [];
    let total = 0;
    let truncated = false;
    for (const entry of settled) {
      if (entry.failed || entry.hits.length === 0) continue;
      const remaining = totalLimit - total;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const hits = entry.hits.slice(0, remaining);
      truncated ||= hits.length < entry.hits.length;
      total += hits.length;
      groups.push({ module: entry.module.key, label: entry.module.label, hits });
    }

    return {
      term: trimmed,
      groups,
      totalHits: total,
      unavailableModules: settled.filter((e) => e.failed).map((e) => e.module.key),
      truncated,
    };
  }
}
