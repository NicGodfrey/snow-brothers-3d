/**
 * Topic patterns for event types.
 *
 * Event types are dot-separated, lowercase-kebab segments as produced by the
 * domain services, e.g. `quality.ncr.opened` or `sales.order.line-added`.
 *
 * Pattern syntax:
 *   literal   `quality.ncr.opened`  exact match
 *   `*`       matches exactly one segment            (`quality.*.opened`)
 *   `**`      matches zero or more segments          (`quality.**`)
 *
 * `**` may appear anywhere; a trailing `**` also matches the empty tail, so
 * `quality.**` matches `quality` itself as well as `quality.ncr.opened`.
 */

export const SEGMENT_SEPARATOR = ".";
export const SINGLE_WILDCARD = "*";
export const MULTI_WILDCARD = "**";

/** Matches every topic. Handy for audit/log subscribers. */
export const MATCH_ALL: string = MULTI_WILDCARD;

export class TopicPatternError extends Error {
  constructor(pattern: string, reason: string) {
    super(`Invalid topic pattern '${pattern}': ${reason}`);
    this.name = "TopicPatternError";
  }
}

const SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/i;

/** Splits and validates a pattern, returning its segments. */
export function parseTopicPattern(pattern: string): readonly string[] {
  if (typeof pattern !== "string" || pattern.trim() === "") {
    throw new TopicPatternError(String(pattern), "must be a non-empty string");
  }
  const segments = pattern.split(SEGMENT_SEPARATOR);
  for (const segment of segments) {
    if (segment === SINGLE_WILDCARD || segment === MULTI_WILDCARD) continue;
    if (segment === "") {
      throw new TopicPatternError(pattern, "empty segment (check for '..' or a leading/trailing dot)");
    }
    if (!SEGMENT_RE.test(segment)) {
      throw new TopicPatternError(
        pattern,
        `segment '${segment}' must be alphanumeric with dashes, '*' or '**'`,
      );
    }
  }
  return segments;
}

/** Validates a concrete (wildcard-free) event type. */
export function parseTopic(topic: string): readonly string[] {
  const segments = parseTopicPattern(topic);
  for (const segment of segments) {
    if (segment === SINGLE_WILDCARD || segment === MULTI_WILDCARD) {
      throw new TopicPatternError(topic, "a concrete topic may not contain wildcards");
    }
  }
  return segments;
}

function matchSegments(
  pattern: readonly string[],
  topic: readonly string[],
  pi: number,
  ti: number,
): boolean {
  let patternIndex = pi;
  let topicIndex = ti;
  while (patternIndex < pattern.length) {
    const segment = pattern[patternIndex]!;
    if (segment === MULTI_WILDCARD) {
      // Trailing `**` swallows whatever is left, including nothing.
      if (patternIndex === pattern.length - 1) return true;
      for (let skip = topicIndex; skip <= topic.length; skip++) {
        if (matchSegments(pattern, topic, patternIndex + 1, skip)) return true;
      }
      return false;
    }
    if (topicIndex >= topic.length) return false;
    if (segment !== SINGLE_WILDCARD && segment !== topic[topicIndex]) return false;
    patternIndex++;
    topicIndex++;
  }
  return topicIndex === topic.length;
}

/** True when `topic` is matched by `pattern`. Both are validated. */
export function matchTopic(pattern: string, topic: string): boolean {
  return matchSegments(parseTopicPattern(pattern), parseTopic(topic), 0, 0);
}

/** True when any of the patterns match. */
export function matchAnyTopic(patterns: readonly string[], topic: string): boolean {
  return patterns.some((pattern) => matchTopic(pattern, topic));
}

/**
 * Ranking score for a pattern: literal segments are worth more than `*`,
 * which is worth more than `**`. Used to order overlapping routing rules so
 * the most specific one wins.
 */
export function patternSpecificity(pattern: string): number {
  let score = 0;
  for (const segment of parseTopicPattern(pattern)) {
    if (segment === MULTI_WILDCARD) score += 0;
    else if (segment === SINGLE_WILDCARD) score += 1;
    else score += 4;
  }
  return score;
}

interface RouterEntry<T> {
  readonly pattern: string;
  readonly value: T;
  /** Registration order, so matches can be returned deterministically. */
  readonly seq: number;
}

interface RouterNode<T> {
  readonly literals: Map<string, RouterNode<T>>;
  single?: RouterNode<T>;
  multi?: RouterNode<T>;
  values: RouterEntry<T>[];
}

function newNode<T>(): RouterNode<T> {
  return { literals: new Map(), values: [] };
}

/**
 * Prefix-tree index from patterns to values. Subscriptions and routing rules
 * both use it so a publish does not have to test every registered pattern.
 */
export class TopicRouter<T> {
  private readonly root: RouterNode<T> = newNode<T>();
  private count = 0;
  private seq = 0;

  get size(): number {
    return this.count;
  }

  add(pattern: string, value: T): void {
    const segments = parseTopicPattern(pattern);
    let node = this.root;
    for (const segment of segments) {
      if (segment === MULTI_WILDCARD) {
        node.multi ??= newNode<T>();
        node = node.multi;
      } else if (segment === SINGLE_WILDCARD) {
        node.single ??= newNode<T>();
        node = node.single;
      } else {
        let next = node.literals.get(segment);
        if (!next) {
          next = newNode<T>();
          node.literals.set(segment, next);
        }
        node = next;
      }
    }
    node.values.push({ pattern, value, seq: this.seq++ });
    this.count++;
  }

  /** Removes one (pattern, value) registration; returns whether it existed. */
  remove(pattern: string, value: T): boolean {
    const segments = parseTopicPattern(pattern);
    let node: RouterNode<T> | undefined = this.root;
    for (const segment of segments) {
      if (!node) return false;
      node =
        segment === MULTI_WILDCARD
          ? node.multi
          : segment === SINGLE_WILDCARD
            ? node.single
            : node.literals.get(segment);
    }
    if (!node) return false;
    const index = node.values.findIndex((entry) => entry.value === value);
    if (index === -1) return false;
    node.values.splice(index, 1);
    this.count--;
    return true;
  }

  /** Removes every registration of `value`, whatever its patterns. */
  removeValue(value: T): number {
    let removed = 0;
    const visit = (node: RouterNode<T>): void => {
      for (let i = node.values.length - 1; i >= 0; i--) {
        if (node.values[i]!.value === value) {
          node.values.splice(i, 1);
          removed++;
        }
      }
      for (const child of node.literals.values()) visit(child);
      if (node.single) visit(node.single);
      if (node.multi) visit(node.multi);
    };
    visit(this.root);
    this.count -= removed;
    return removed;
  }

  /** All distinct values whose pattern matches `topic`, in registration order. */
  match(topic: string): T[] {
    const segments = parseTopic(topic);
    const collected: RouterEntry<T>[] = [];
    // `index` is how many topic segments have been consumed on this path.
    const walk = (node: RouterNode<T>, index: number): void => {
      if (index === segments.length) collected.push(...node.values);
      if (index < segments.length) {
        const literal = node.literals.get(segments[index]!);
        if (literal) walk(literal, index + 1);
        if (node.single) walk(node.single, index + 1);
      }
      if (node.multi) {
        // `**` consumes any number of remaining segments, zero included.
        for (let skip = index; skip <= segments.length; skip++) {
          walk(node.multi, skip);
        }
      }
    };
    walk(this.root, 0);
    collected.sort((a, b) => a.seq - b.seq);

    const seen = new Set<T>();
    const result: T[] = [];
    for (const entry of collected) {
      if (seen.has(entry.value)) continue;
      seen.add(entry.value);
      result.push(entry.value);
    }
    return result;
  }

  /** Every registered (pattern, value) pair, in registration order. */
  entries(): { pattern: string; value: T }[] {
    const out: RouterEntry<T>[] = [];
    const visit = (node: RouterNode<T>): void => {
      out.push(...node.values);
      for (const child of node.literals.values()) visit(child);
      if (node.single) visit(node.single);
      if (node.multi) visit(node.multi);
    };
    visit(this.root);
    return out
      .sort((a, b) => a.seq - b.seq)
      .map((entry) => ({ pattern: entry.pattern, value: entry.value }));
  }
}
