import assert from 'node:assert/strict';
import test from 'node:test';
import { enforceLatestOnly, repository } from './latest-only.mjs';

const base = `repos/${repository}/releases`;
const release = (id, overrides = {}) => ({
  id,
  tag_name: `v0.1.${id}`,
  draft: false,
  prerelease: false,
  immutable: false,
  assets: [`Photo.Takeout.Fixer_0.1.${id}_x64-setup.exe`, 'release-metadata.json', 'SHA256SUMS.txt']
    .map(name => ({ name, state: 'uploaded', size: 123 })),
  ...overrides,
});

function fixture(initial, latestId) {
  const releases = structuredClone(initial);
  const patches = [];
  let currentId = latestId;
  const api = async (method, endpoint, body) => {
    if (method === 'GET' && endpoint === `${base}/latest`) {
      const latest = releases.find(item => item.id === currentId);
      if (!latest) throw Error('No published stable release (404).');
      return structuredClone(latest);
    }
    if (method === 'GET' && endpoint.startsWith(`${base}?`)) {
      const page = Number(new URLSearchParams(endpoint.split('?')[1]).get('page'));
      return structuredClone(releases.slice((page - 1) * 100, page * 100));
    }
    if (method === 'PATCH') {
      assert.deepEqual(body, { draft: true });
      const id = Number(endpoint.slice(base.length + 1));
      assert.notEqual(id, currentId, 'Never unpublish the current latest');
      patches.push(id);
      const item = releases.find(item => item.id === id);
      item.draft = true;
      return structuredClone(item);
    }
    throw Error(`Unexpected API request: ${method} ${endpoint}`);
  };
  return { api, patches, releases, setLatest: id => { currentId = id; } };
}

const run = (state, options = {}) => enforceLatestOnly({ api: state.api, apply: true, log: () => {}, ...options });

test('unpublishes older versions and prereleases; preserves latest and existing drafts byte-for-byte', async () => {
  const state = fixture([release(3), release(2), release(1), release(4, { prerelease: true }), release(5, { draft: true })], 3);
  const original = structuredClone(state.releases);
  await run(state);
  assert.deepEqual(state.patches, [2, 1, 4]);
  for (let index = 0; index < state.releases.length; index++) {
    assert.deepEqual(state.releases[index], { ...original[index], draft: original[index].id !== 3 });
  }
  state.patches.length = 0;
  await run(state);
  assert.deepEqual(state.patches, [], 'Reruns are idempotent');
});

test('defaults to a read-only dry run', async () => {
  const state = fixture([release(2), release(1)], 2);
  const result = await enforceLatestOnly({ api: state.api, log: () => {} });
  assert.deepEqual(state.patches, []);
  assert.equal(result.applied, false);
  assert.deepEqual(result.hidden, ['v0.1.1']);
});

test('paginates all releases including inventories with 100 drafts before old downloads', async () => {
  const drafts = Array.from({ length: 100 }, (_, index) => release(index + 10, { draft: true }));
  const state = fixture([...drafts, release(3), release(2), release(1)], 3);
  await run(state);
  assert.deepEqual(state.patches, [2, 1]);
});

test('no latest, draft/prerelease latest, or missing latest assets causes zero mutations', async () => {
  for (const overrides of [null, { draft: true }, { prerelease: true }, { assets: [] }, { tag_name: 'invalid' }]) {
    const state = fixture([release(1), ...(overrides ? [release(2, overrides)] : [])], 2);
    await assert.rejects(run(state));
    assert.deepEqual(state.patches, []);
  }
});

test('inventory error or malformed release stops before changing anything', async () => {
  const state = fixture([release(3), release(2), release(1, { draft: undefined })], 3);
  await assert.rejects(run(state), /Invalid release/);
  assert.deepEqual(state.patches, []);
});

test('immutable old release stops before any mutations', async () => {
  const state = fixture([release(3), release(2), release(1, { immutable: true })], 3);
  await assert.rejects(run(state), /immutable/);
  assert.deepEqual(state.patches, []);
});

test('change of latest before a mutation aborts instead of hiding the new latest', async () => {
  const state = fixture([release(3), release(2), release(1)], 3);
  let reads = 0;
  await assert.rejects(run(state, { api: async (...args) => {
    if (args[1] === `${base}/latest` && ++reads === 2) state.setLatest(2);
    return state.api(...args);
  } }), /Latest release changed/);
  assert.deepEqual(state.patches, []);
});

test('partial API failure is explicit and can be safely retried', async () => {
  const state = fixture([release(3), release(2), release(1)], 3);
  await assert.rejects(run(state, { api: async (...args) => {
    if (args[0] === 'PATCH' && args[1] === `${base}/1`) throw Error('API unavailable');
    return state.api(...args);
  } }), /API unavailable/);
  assert.deepEqual(state.patches, [2]);
  await run(state);
  assert.deepEqual(state.patches, [2, 1]);
});

test('a new public prerelease during enforcement fails final verification', async () => {
  const state = fixture([release(3), release(2)], 3);
  await assert.rejects(run(state, { api: async (...args) => {
    const result = await state.api(...args);
    if (args[0] === 'PATCH') state.releases.push(release(4, { prerelease: true }));
    return result;
  } }), /still public/);
});

test('an unexpected mutation response is never reported as success', async () => {
  const state = fixture([release(3), release(2)], 3);
  await assert.rejects(run(state, { api: async (...args) => {
    if (args[0] === 'PATCH') return release(2);
    return state.api(...args);
  } }), /did not unpublish/);
});
