import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const repository = 'Doronn4/photo-takeout-fixer-releases';
const releasesPath = `repos/${repository}/releases`;

export function githubApi(method, endpoint, body) {
  const args = ['api', '--hostname', 'github.com', '--method', method, endpoint];
  if (body) args.push('--input', '-');
  return JSON.parse(execFileSync('gh', args, {
    encoding: 'utf8',
    input: body ? JSON.stringify(body) : undefined,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  }));
}

function validateRelease(release) {
  if (!Number.isSafeInteger(release?.id) || release.id <= 0 ||
      typeof release.tag_name !== 'string' || !release.tag_name ||
      typeof release.draft !== 'boolean' || typeof release.prerelease !== 'boolean') {
    throw Error('Invalid release response; no further releases will be changed.');
  }
  return release;
}

function validateLatest(release) {
  validateRelease(release);
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
    throw Error('Latest must be a published stable version.');
  }
  const version = release.tag_name.slice(1);
  for (const name of [`Photo.Takeout.Fixer_${version}_x64-setup.exe`, 'release-metadata.json', 'SHA256SUMS.txt']) {
    const asset = release.assets?.find(item => item.name === name);
    if (!asset || asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw Error(`Latest release is incomplete: ${name}`);
    }
  }
  return release;
}

async function listReleases(api) {
  const releases = [];
  const ids = new Set();
  for (let page = 1; ; page++) {
    const batch = await api('GET', `${releasesPath}?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw Error('Invalid release listing.');
    for (const release of batch) {
      validateRelease(release);
      if (ids.has(release.id)) throw Error('Release listing changed during pagination; retry.');
      ids.add(release.id);
      releases.push(release);
    }
    if (batch.length < 100) return releases;
  }
}

// Keep assets intact as owner-only drafts. Nothing is deleted or re-uploaded.
export async function enforceLatestOnly({ api = githubApi, apply = false, expectedTag, log = console.log } = {}) {
  if (expectedTag !== undefined && !/^v\d+\.\d+\.\d+$/.test(expectedTag)) {
    throw Error('Expected release tag must be a stable version such as v0.1.3.');
  }
  const latest = validateLatest(await api('GET', `${releasesPath}/latest`));
  if (expectedTag !== undefined && latest.tag_name !== expectedTag) {
    throw Error(`Expected ${expectedTag} to be latest, but GitHub reports ${latest.tag_name}; nothing changed.`);
  }
  const releases = await listReleases(api);
  if (!releases.some(release => release.id === latest.id && !release.draft && !release.prerelease)) {
    throw Error('Latest release changed during inventory; retry.');
  }
  const obsolete = releases.filter(release => release.id !== latest.id && !release.draft);
  if (obsolete.some(release => release.immutable)) {
    throw Error('An obsolete release is immutable and cannot become a draft; owner intervention required.');
  }
  log(`Keep ${latest.tag_name}; ${apply ? 'hide' : 'would hide'} ${obsolete.length} other published release(s).`);

  const assertLatestUnchanged = async () => {
    const current = validateLatest(await api('GET', `${releasesPath}/latest`));
    if (current.id !== latest.id || current.tag_name !== latest.tag_name) {
      throw Error('Latest release changed; stopped to protect the current download. Rerun the policy.');
    }
  };
  for (const release of obsolete) {
    if (!apply) {
      log(`Would make ${release.tag_name} an owner-only draft.`);
      continue;
    }
    await assertLatestUnchanged();
    const updated = validateRelease(await api('PATCH', `${releasesPath}/${release.id}`, { draft: true }));
    if (updated.id !== release.id || updated.draft !== true) throw Error('GitHub did not unpublish the requested release.');
    log(`Hidden ${release.tag_name}; retained assets for repository writers.`);
  }
  if (apply) {
    await assertLatestUnchanged();
    const published = (await listReleases(api)).filter(release => !release.draft);
    if (published.length !== 1 || published[0].id !== latest.id) {
      throw Error('More than the latest release is still public; rerun the policy.');
    }
    log(`Verified: ${latest.tag_name} is the only published release.`);
  }
  return { latest: latest.tag_name, hidden: obsolete.map(release => release.tag_name), applied: apply };
}

export function validateCaller(workflowRepository, expectedTag) {
  const sourceRepository = 'Doronn4/photo-takeout-fixer';
  if (workflowRepository && ![repository, sourceRepository].includes(workflowRepository)) {
    throw Error('Run this workflow only in the dedicated downloads or source repository.');
  }
  if (workflowRepository === sourceRepository && !/^v\d+\.\d+\.\d+$/.test(expectedTag ?? '')) {
    throw Error('Source release CI must specify PTF_EXPECTED_RELEASE_TAG.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw Error('Usage: node latest-only.mjs [--apply]');
  const expectedTag = process.env.PTF_EXPECTED_RELEASE_TAG;
  validateCaller(process.env.GITHUB_REPOSITORY, expectedTag);
  await enforceLatestOnly({ apply: process.argv.includes('--apply'), expectedTag });
}
