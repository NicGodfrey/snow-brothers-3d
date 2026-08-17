import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CAT_STATS } from '../../src/game/defaults';
import { catSpeed, catStateLabel, createCat, distractCats, freezeCat } from '../../src/game/cat';
import { catSpeedForState, setCatState } from '../../src/game/brain';

test('createCat uses breed stats and chase outruns patrol', () => {
  const cat = createCat(1, 4, 4, 'tabby');
  assert.equal(cat.breed, 'tabby');
  assert.equal(cat.state, 'patrol');
  assert.ok(cat.stats.chaseSpeed > cat.stats.patrolSpeed);
  assert.ok(DEFAULT_CAT_STATS.sightRange > 0);
  assert.ok(DEFAULT_CAT_STATS.sightHalfAngle > 0);
  assert.ok(catSpeed(cat) > 0);
  setCatState(cat, 'chase');
  assert.ok(catSpeedForState(cat) > catSpeedForState({ ...cat, state: 'patrol' }));
  assert.equal(catStateLabel('chase'), 'chasing');
});

test('freezeCat and distractCats change state', () => {
  const cat = createCat(2, 1, 1);
  freezeCat(cat, 1.5);
  assert.ok(cat.frozen >= 1.5);
  cat.frozen = 0;
  distractCats([cat], 8, 8, 1);
  assert.equal(cat.state, 'investigate');
  assert.ok(cat.lastKnown);
});
