import type { StageDef, TileGlyph } from './schema';
import { TILE_LEGEND, isTileGlyph } from './schema';

export const WALKABLE: ReadonlySet<string> = new Set(['.', 'r', 'g', 'v', 'o', '_', 'G', 'p', 's', 'L', '~']);
export const SOLID: ReadonlySet<string> = new Set(['#', 'X', 'T', 'D', ' ']);

export interface StageIssue {
  readonly path: string;
  readonly message: string;
}

export function validateStage(stage: StageDef): StageIssue[] {
  const issues: StageIssue[] = [];
  if (!stage.id) issues.push({ path: 'id', message: 'missing id' });
  if (stage.width < 8 || stage.height < 8) {
    issues.push({ path: 'size', message: `stage too small: ${stage.width}x${stage.height}` });
  }
  if (stage.tiles.length !== stage.height) {
    issues.push({ path: 'tiles', message: `expected ${stage.height} rows, got ${stage.tiles.length}` });
  }
  if (stage.decor.length !== stage.height) {
    issues.push({ path: 'decor', message: `expected ${stage.height} decor rows, got ${stage.decor.length}` });
  }
  for (let y = 0; y < stage.tiles.length; y += 1) {
    const row = stage.tiles[y] ?? '';
    if (row.length !== stage.width) {
      issues.push({ path: `tiles[${y}]`, message: `expected width ${stage.width}, got ${row.length}` });
    }
    for (let x = 0; x < row.length; x += 1) {
      const ch = row[x] ?? '';
      if (!isTileGlyph(ch)) {
        issues.push({ path: `tiles[${y}][${x}]`, message: `unknown glyph '${ch}'` });
      }
    }
  }
  for (let y = 0; y < stage.decor.length; y += 1) {
    const row = stage.decor[y] ?? '';
    if (row.length !== stage.width) {
      issues.push({ path: `decor[${y}]`, message: `expected width ${stage.width}, got ${row.length}` });
    }
  }
  if (!inBounds(stage, stage.spawn.x, stage.spawn.y)) {
    issues.push({ path: 'spawn', message: `spawn out of bounds (${stage.spawn.x},${stage.spawn.y})` });
  } else if (!walkableAt(stage, stage.spawn.x, stage.spawn.y)) {
    issues.push({ path: 'spawn', message: `spawn not walkable (${stage.spawn.x},${stage.spawn.y})` });
  }
  const cheeses = stage.entities.filter((entity) => entity.type === 'cheese');
  const holes = stage.entities.filter((entity) => entity.type === 'hole');
  const cats = stage.entities.filter((entity) => entity.type === 'cat');
  if (cheeses.length < stage.quota) {
    issues.push({ path: 'quota', message: `quota ${stage.quota} exceeds cheese count ${cheeses.length}` });
  }
  if (holes.length < 1) issues.push({ path: 'entities', message: 'need at least one hole' });
  if (stage.kind !== 'arcade' && cats.length < 1) {
    issues.push({ path: 'entities', message: 'need at least one cat' });
  }
  for (const entity of stage.entities) {
    if (!inBounds(stage, entity.x, entity.y)) {
      issues.push({ path: `entity:${entity.type}`, message: `out of bounds (${entity.x},${entity.y})` });
    }
  }
  for (const light of stage.lights) {
    if (!inBounds(stage, light.x, light.y)) {
      issues.push({ path: 'lights', message: `light out of bounds (${light.x},${light.y})` });
    }
  }
  if (stage.objectives.length < 1) {
    issues.push({ path: 'objectives', message: 'need at least one objective' });
  }
  if (stage.quota < 1) issues.push({ path: 'quota', message: 'quota must be positive' });
  return issues;
}

export function inBounds(stage: Pick<StageDef, 'width' | 'height'>, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < stage.width && y < stage.height;
}

export function walkableAt(stage: Pick<StageDef, 'tiles'>, x: number, y: number): boolean {
  const row = stage.tiles[y];
  if (!row) return false;
  return WALKABLE.has(row[x] ?? '');
}

export function glyphName(ch: string): string {
  if (isTileGlyph(ch)) return TILE_LEGEND[ch as TileGlyph];
  return 'unknown';
}

export function assertStage(stage: StageDef): void {
  const issues = validateStage(stage);
  if (issues.length > 0) {
    throw new Error(`${stage.id}: ${issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`);
  }
}
