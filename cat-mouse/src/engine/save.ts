import { DEFAULT_BINDINGS } from './input';
import type { KeyBindings, SaveSlot, SettingsState, StageRecord } from './types';

export const SAVE_VERSION = 1;
export const SAVE_PREFIX = 'cat-mouse:save:';

export function defaultSettings(): SettingsState {
  return {
    masterVolume: 0.85,
    sfxVolume: 1,
    musicVolume: 0.7,
    showDebug: false,
    screenShake: true,
    highContrast: false,
    bindings: {},
  };
}

export function emptyTotals(): SaveSlot['totals'] {
  return { cheese: 0, catches: 0, deaths: 0, playSeconds: 0, dashes: 0, stealthClears: 0 };
}

export function emptySave(profile: string): SaveSlot {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    profile,
    createdAt: now,
    updatedAt: now,
    unlockedChapters: 1,
    stageRecords: {},
    achievements: [],
    settings: defaultSettings(),
    totals: emptyTotals(),
  };
}

export function emptyStageRecord(stageId: string): StageRecord {
  return {
    stageId,
    cleared: false,
    bestScore: 0,
    bestTime: 0,
    stars: 0,
    attempts: 0,
    noCatchClear: false,
  };
}

export function serializeSave(slot: SaveSlot): string {
  return JSON.stringify(slot);
}

export function parseSave(raw: string): SaveSlot | null {
  try {
    const data = JSON.parse(raw) as Partial<SaveSlot>;
    if (!data || typeof data !== 'object') return null;
    if (typeof data.profile !== 'string' || data.profile.length === 0) return null;
    const base = emptySave(data.profile);
    return {
      ...base,
      ...data,
      version: typeof data.version === 'number' ? data.version : SAVE_VERSION,
      profile: data.profile,
      createdAt: numberOr(data.createdAt, base.createdAt),
      updatedAt: numberOr(data.updatedAt, base.updatedAt),
      unlockedChapters: numberOr(data.unlockedChapters, 1),
      stageRecords: data.stageRecords ?? {},
      achievements: Array.isArray(data.achievements) ? data.achievements : [],
      settings: { ...defaultSettings(), ...(data.settings ?? {}) },
      totals: { ...emptyTotals(), ...(data.totals ?? {}) },
    };
  } catch {
    return null;
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function touchStage(slot: SaveSlot, patch: Partial<StageRecord> & { stageId: string }): StageRecord {
  const prev = slot.stageRecords[patch.stageId] ?? emptyStageRecord(patch.stageId);
  const next: StageRecord = {
    ...prev,
    ...patch,
    bestScore: Math.max(prev.bestScore, patch.bestScore ?? prev.bestScore),
    stars: Math.max(prev.stars, patch.stars ?? prev.stars),
    attempts: patch.attempts ?? prev.attempts,
    noCatchClear: prev.noCatchClear || Boolean(patch.noCatchClear),
    cleared: prev.cleared || Boolean(patch.cleared),
  };
  if (patch.bestTime && patch.bestTime > 0) {
    next.bestTime = prev.bestTime > 0 ? Math.min(prev.bestTime, patch.bestTime) : patch.bestTime;
  }
  slot.stageRecords[patch.stageId] = next;
  slot.updatedAt = Date.now();
  return next;
}

export function unlockAchievement(slot: SaveSlot, id: string): boolean {
  if (slot.achievements.includes(id)) return false;
  slot.achievements.push(id);
  slot.updatedAt = Date.now();
  return true;
}

export function unlockChapter(slot: SaveSlot, chapter: number): void {
  slot.unlockedChapters = Math.max(slot.unlockedChapters, chapter);
  slot.updatedAt = Date.now();
}

export function isChapterUnlocked(slot: SaveSlot, chapter: number): boolean {
  return chapter <= slot.unlockedChapters;
}

export function resolvedBindings(settings: SettingsState): KeyBindings {
  const out = { ...DEFAULT_BINDINGS };
  for (const key of Object.keys(settings.bindings) as (keyof KeyBindings)[]) {
    const list = settings.bindings[key];
    if (list && list.length > 0) out[key] = [...list];
  }
  return out;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
}

function defaultStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // sandboxed / disabled
  }
  return new MemoryStorage();
}

export class SaveStore {
  private readonly storage: StorageLike;
  private readonly prefix: string;

  constructor(storage: StorageLike = defaultStorage(), prefix = SAVE_PREFIX) {
    this.storage = storage;
    this.prefix = prefix;
  }

  keyFor(profile: string): string {
    return `${this.prefix}${profile}`;
  }

  list(): string[] {
    const names: string[] = [];
    for (let i = 0; i < this.storage.length; i += 1) {
      const key = this.storage.key(i);
      if (!key || !key.startsWith(this.prefix)) continue;
      names.push(key.slice(this.prefix.length));
    }
    return names.sort();
  }

  load(profile: string): SaveSlot | null {
    const raw = this.storage.getItem(this.keyFor(profile));
    if (!raw) return null;
    return parseSave(raw);
  }

  write(slot: SaveSlot): void {
    slot.updatedAt = Date.now();
    this.storage.setItem(this.keyFor(slot.profile), serializeSave(slot));
  }

  loadOrCreate(profile: string): SaveSlot {
    return this.load(profile) ?? emptySave(profile);
  }

  delete(profile: string): void {
    this.storage.removeItem(this.keyFor(profile));
  }

  clearAll(): void {
    for (const name of this.list()) this.delete(name);
  }
}

export function makeSaveStore(storage?: StorageLike): SaveStore {
  return new SaveStore(storage);
}
