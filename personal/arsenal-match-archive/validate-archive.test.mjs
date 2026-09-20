import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { loadArchive, auditArchive } from './validate-archive.mjs';

const baselineText = execFileSync('git', [
  'show',
  '6f5444357a730aad4b03da3f0c24706cc548ccd2:personal/arsenal-match-archive/matches.js'
], { encoding: 'utf8' });
const original = loadArchive(baselineText);
const copy = () => structuredClone(original);

test('partial baseline has known counts', () => {
  const { counts, errors } = auditArchive(copy(), { complete: false, baselineMatches: original });
  assert.deepEqual(counts, { premierLeague: 15, championsLeague: 5, total: 20 });
  assert.deepEqual(errors, []);
});

test('impossible date is rejected', () => {
  const data = copy();
  data.find(m => m.season === '2025-26').date = '2026-02-30';
  assert.match(auditArchive(data, { complete: false }).errors.join(' '), /date/i);
});

test('complete mode rejects the baseline undercount', () => {
  assert.match(auditArchive(copy(), { complete: true }).errors.join(' '), /38|15|53/);
});

test('duplicate ID and duplicate round are distinct failures', () => {
  const withDuplicateId = copy();
  withDuplicateId.push(structuredClone(withDuplicateId.find(m => m.season === '2025-26')));
  assert.match(auditArchive(withDuplicateId, { complete: false }).errors.join(' '), /id/i);

  const withDuplicateRound = copy();
  const extra = structuredClone(withDuplicateRound.find(m => m.season === '2025-26' && m.competition === 'Premier League'));
  extra.id += '-second';
  withDuplicateRound.push(extra);
  assert.match(auditArchive(withDuplicateRound, { complete: false }).errors.join(' '), /round/i);
});

test('two meetings with one opponent remain separate when rounds differ', () => {
  const data = copy();
  const extra = structuredClone(data.find(m => m.season === '2025-26' && m.round === '1R'));
  extra.id += '-return';
  extra.round = '38R';
  data.push(extra);
  assert.deepEqual(auditArchive(data, { complete: false }).errors, []);
});

test('duplicate source and unsafe media URL fail', () => {
  const data = copy();
  const match = data.find(m => m.season === '2025-26');
  match.sources[1].url = match.sources[0].url;
  match.media[0].url = 'javascript:alert(1)';
  assert.match(auditArchive(data, { complete: false }).errors.join(' '), /source/i);
  assert.match(auditArchive(data, { complete: false }).errors.join(' '), /media/i);
});

test('2026-27 mutation is rejected', () => {
  const data = copy();
  data.find(m => m.season === '2026-27').subtitle += 'changed';
  assert.match(auditArchive(data, { complete: false, baselineMatches: original }).errors.join(' '), /2026-27/);
});
