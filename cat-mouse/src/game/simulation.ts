import type { InputSnapshot } from '../engine/types';
import { EventBus } from '../engine/events';
import { DEFAULT_STEP } from '../engine/loop';
import { makeRng } from '../engine/rng';
import type { StageDef } from '../content/schema';
import type { GameMode, SimulationOptions, StageOutcome, StageResult } from './types';
import { loadStage, allocateOn, type LoadedStage } from './stageLoad';
import { catchMouse, mouseStep, overlappingCat, type MouseWorld } from './mouse';
import { catStep, distractCats, resetCatAfterCatch, type CatWorld } from './cat';
import { tickHazards } from './hazards';
import { tickPowerUps } from './powerups';
import { tickDecoys } from './senses';
import { evaluateStars, quotaMet, registerCatch, stageResultOf, tickScore, addHeat, heatFromNoise } from './score';
import { applyDirectorToCats, tickDirector, noteDirectorEvent } from './director';
import { emptyInput } from './input';

export class GameSimulation {
  readonly stage: LoadedStage;
  readonly events: EventBus;
  readonly options: SimulationOptions;
  paused = false;
  private enterFired = false;

  constructor(def: StageDef, options: Partial<SimulationOptions> = {}) {
    const seed = options.seed ?? def.seed;
    const rng = options.rng ?? makeRng(seed);
    this.options = {
      rng,
      mode: options.mode ?? modeOf(def.kind),
      difficulty: options.difficulty ?? def.difficulty,
      seed,
    };
    this.events = new EventBus();
    this.stage = loadStage(def, this.options.difficulty, seed);
  }

  get outcome(): StageOutcome {
    return this.stage.outcome;
  }

  abort(): StageResult {
    this.finish('aborted');
    return (
      this.stage.result ??
      stageResultOf('aborted', this.stage.def.id, this.stage.score, this.stage.def.parTime)
    );
  }

  step(input: InputSnapshot = emptyInput(), dt = DEFAULT_STEP): StageOutcome {
    if (this.paused || this.stage.outcome !== 'playing') return this.stage.outcome;
    const stage = this.stage;

    if (!this.enterFired) {
      this.enterFired = true;
      const beat = stage.def.dialogue.find((d) => d.at === 'enter');
      if (beat) this.events.emit('dialogue:beat', { speaker: beat.speaker, line: beat.line });
    }

    if (stage.noise) {
      stage.noise.age += dt;
      if (stage.noise.age > 1.4 || stage.noise.loudness < 0.04) stage.noise = null;
    }

    const world = this.mouseWorld();
    const result = mouseStep(stage.mouse, input, world, dt);
    if (result.scent > 0) stage.scent.deposit(stage.mouse.transform.x, stage.mouse.transform.y, result.scent * dt * 6);
    if (result.noise > 0.04) {
      stage.noise = { x: stage.mouse.transform.x, y: stage.mouse.transform.y, loudness: result.noise, age: 0 };
      addHeat(stage.score, heatFromNoise(result.noise));
    }
    if (result.noise >= 3.5) {
      distractCats(stage.cats, stage.mouse.transform.x, stage.mouse.transform.y, 1.4);
      noteDirectorEvent(stage.director, 'noiseBomb');
    }

    stage.scent.tick(dt, stage.tiles);
    tickDecoys(stage.decoys, dt);
    tickPowerUps(stage.powerUps, dt);

    const catWorld = this.catWorld();
    let spotted = false;
    for (let i = 0; i < stage.cats.length; i += 1) {
      const cat = stage.cats[i]!;
      const step = catStep(cat, catWorld, dt);
      if (step.spotted || cat.state === 'chase' || cat.state === 'pounce') spotted = true;
      if (cat.frozen > 0) continue;
      if (overlappingCat(stage.mouse, cat)) {
        const caught = catchMouse(stage.mouse, world, cat.transform.x, cat.transform.y);
        if (caught) {
          registerCatch(stage.score);
          noteDirectorEvent(stage.director, 'catch');
          addHeat(stage.score, 0.2);
          if (stage.mouse.lives <= 0) return this.finish('lost');
          for (const other of stage.cats) resetCatAfterCatch(other);
        }
      }
    }
    stage.spotted = spotted;

    const hazard = tickHazards(stage.hazards, stage.mouse, stage.cats, dt, this.events);
    if (hazard.noise > 0.2) {
      stage.noise = { x: stage.mouse.transform.x, y: stage.mouse.transform.y, loudness: hazard.noise, age: 0 };
      addHeat(stage.score, heatFromNoise(hazard.noise));
    }

    tickScore(stage.score, dt);
    tickDirector(stage.director, stage.score, stage.cats.length, dt, spotted);
    applyDirectorToCats(stage.director, stage.cats, dt);

    evaluateStars(stage.score, stage.def.parTime);

    if (quotaMet(stage.score)) return this.finish('won');
    if (this.timeLimitExceeded()) return this.finish('lost');
    if (this.options.mode === 'timeAttack' && stage.def.parTime > 0 && stage.score.timeSeconds > stage.def.parTime * 2) {
      return this.finish('lost');
    }

    return stage.outcome;
  }

  private timeLimitExceeded(): boolean {
    for (const obj of this.stage.def.objectives) {
      if (obj.kind === 'timeLimit' && !obj.optional && this.stage.score.timeSeconds > obj.value) return true;
    }
    return false;
  }

  private finish(outcome: StageOutcome): StageOutcome {
    const stage = this.stage;
    stage.outcome = outcome;
    stage.result = stageResultOf(outcome, stage.def.id, stage.score, stage.def.parTime);
    if (outcome === 'won') this.events.emit('stage:won', stage.result);
    if (outcome === 'lost') this.events.emit('stage:lost', stage.result);
    const beatAt = outcome === 'won' ? 'win' : outcome === 'lost' ? 'lose' : null;
    if (beatAt) {
      const beat = stage.def.dialogue.find((d) => d.at === beatAt);
      if (beat) this.events.emit('dialogue:beat', { speaker: beat.speaker, line: beat.line });
    }
    return outcome;
  }

  private mouseWorld(): MouseWorld {
    const stage = this.stage;
    return {
      tiles: stage.tiles,
      cheeses: stage.cheeses,
      holes: stage.holes,
      powerUps: stage.powerUps,
      switches: stage.switches,
      doors: stage.doors,
      lights: stage.lights,
      decoys: stage.decoys,
      cats: stage.cats,
      keys: stage.keys,
      crumbs: stage.crumbs,
      score: stage.score,
      events: this.events,
      rng: this.options.rng,
      allocateEntity: () => allocateOn(stage),
      setDoorOpen: (tx, ty, open) => stage.tiles.setDoorOpen(tx, ty, open),
    };
  }

  private catWorld(): CatWorld {
    const stage = this.stage;
    return {
      tiles: stage.tiles,
      mouse: stage.mouse,
      scent: stage.scent,
      lights: stage.lights,
      decoys: stage.decoys,
      holes: stage.holes,
      noise: stage.noise,
      events: this.events,
      rng: this.options.rng,
      ambient: stage.def.ambient,
      intensity: stage.director.intensity,
      hints: {
        ambushSpots: stage.hints.ambushSpots,
        searchSpots: stage.hints.searchSpots,
        aggression: stage.hints.aggression,
        scentBias: stage.hints.scentBias,
        hearingBias: stage.hints.hearingBias,
        campHoleChance: stage.hints.campHoleChance,
        leashRadius: stage.hints.leashRadius,
      },
    };
  }
}

function modeOf(kind: StageDef['kind']): GameMode {
  if (kind === 'arcade') return 'arcade';
  if (kind === 'timeAttack') return 'timeAttack';
  return 'story';
}

export function createSimulation(def: StageDef, options?: Partial<SimulationOptions>): GameSimulation {
  return new GameSimulation(def, options);
}

export function stepSimulation(
  sim: GameSimulation,
  input: InputSnapshot = emptyInput(),
  dt = DEFAULT_STEP,
): StageOutcome {
  return sim.step(input, dt);
}
