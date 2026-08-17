import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssetLoader, makeAssets } from '../../src/engine/assets';

test('AssetLoader put/get/require and missing assets throw', () => {
  const assets = makeAssets();
  assets.put('theme', { id: 'cellar' });
  assert.equal(assets.has('theme'), true);
  assert.deepEqual(assets.get('theme'), { id: 'cellar' });
  assert.deepEqual(assets.require('theme'), { id: 'cellar' });
  assert.throws(() => assets.require('missing'));
  assert.equal(assets.progress, 1);
  const extra = new AssetLoader();
  extra.put('k', 1);
  assert.equal(extra.snapshot().loaded, 0);
});
