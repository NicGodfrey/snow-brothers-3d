import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine, CUES, makeAudio } from '../../src/engine/audio';

test('audio engine is safe without a context and mute zeros gain', () => {
  const audio = makeAudio();
  audio.setListener(10, 10);
  audio.setBusGain('sfx', 0.5);
  assert.equal(audio.busGain('sfx'), 0.5);
  audio.duck('music', 0.8, 0.2);
  audio.update(0.05);
  audio.muted = true;
  assert.equal(audio.effectiveGain('sfx'), 0);
  audio.play(CUES.caught);
  assert.equal(audio.voiceCount, 0);
});

test('spatialGain falls off with distance', () => {
  const audio = new AudioEngine({ minDistance: 10, maxDistance: 110, rolloff: 1 });
  audio.setListener(0, 0);
  assert.equal(audio.spatialGain(0, 0), 1);
  assert.equal(audio.spatialGain(200, 0), 0);
  const mid = audio.spatialGain(60, 0);
  assert.ok(mid > 0 && mid < 1);
});
