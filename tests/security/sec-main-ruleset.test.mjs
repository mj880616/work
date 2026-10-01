import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  evaluateMainRuleset,
  findReadyMainRuleset,
  verifyNecessaryChecks,
} from '../../scripts/publication-pr-policy.mjs';

const applied = () => JSON.parse(readFileSync(new URL('../../docs/main-pr-gate-ruleset.json', import.meta.url), 'utf8'));

test('the applied main-protect ruleset is accepted by content, not by name', () => {
  const result = evaluateMainRuleset(applied(), 'main');
  assert.deepEqual(result, { ready: true, problems: [], warnings: [] });
  assert.equal(evaluateMainRuleset({ ...applied(), name: 'anything else' }, 'main').ready, true);
  const explicit = applied();
  explicit.conditions.ref_name.include = ['refs/heads/main'];
  assert.equal(evaluateMainRuleset(explicit, 'main').ready, true);
});

test('a hidden bypass list is a warning, a visible one must be empty', () => {
  const hidden = applied();
  delete hidden.bypass_actors;
  assert.deepEqual(evaluateMainRuleset(hidden, 'main'), {
    ready: true, problems: [], warnings: ['bypass actors are not visible to this token'],
  });
  const bypassed = { ...applied(), bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }] };
  assert.deepEqual(evaluateMainRuleset(bypassed, 'main').problems, ['has bypass actors']);
  assert.deepEqual(evaluateMainRuleset({ ...hidden, current_user_can_bypass: 'always' }, 'main').problems, ['workflow token can bypass']);
});

test('every missing protection is rejected', () => {
  const without = type => ({ ...applied(), rules: applied().rules.filter(rule => rule.type !== type) });
  const cases = [
    [{ ...applied(), enforcement: 'disabled' }, 'enforcement is disabled'],
    [{ ...applied(), enforcement: 'evaluate' }, 'enforcement is evaluate'],
    [{ ...applied(), target: 'tag' }, 'target is not branch'],
    [{ ...applied(), conditions: { ref_name: { include: ['refs/heads/release'], exclude: [] } } }, 'does not target main'],
    [{ ...applied(), conditions: { ref_name: { include: ['~ALL'], exclude: [] } } }, 'does not target main'],
    [{ ...applied(), conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: ['refs/heads/main'] } } }, 'has branch exclusions'],
    [without('deletion'), 'missing deletion rule'],
    [without('non_fast_forward'), 'missing non_fast_forward rule'],
    [without('pull_request'), 'missing pull_request rule'],
    [without('required_status_checks'), 'missing required check publication-gate'],
  ];
  for (const [ruleset, problem] of cases) {
    const result = evaluateMainRuleset(ruleset, 'main');
    assert.equal(result.ready, false, problem);
    assert.ok(result.problems.includes(problem), `${problem}: ${result.problems}`);
  }
  assert.ok(evaluateMainRuleset(applied(), 'master').problems.includes('default branch is master, not main'));
});

test('required checks must come from GitHub Actions and include dropzone', () => {
  const withChecks = checks => {
    const ruleset = applied();
    ruleset.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks = checks;
    return evaluateMainRuleset(ruleset, 'main').problems;
  };
  assert.deepEqual(withChecks([{ context: 'publication-gate', integration_id: 15368 }]), ['missing required check dropzone']);
  assert.deepEqual(withChecks([
    { context: 'publication-gate', integration_id: 1 },
    { context: 'dropzone', integration_id: 15368 },
  ]), ['missing required check publication-gate']);
});

test('ruleset lookup finds the protecting ruleset among others and reports rejections', async () => {
  const rulesets = {
    1: { id: 1, name: 'tags', target: 'tag', enforcement: 'active', rules: [] },
    24278798: { ...applied(), id: 24278798 },
  };
  const fetchImpl = async url => ({
    ok: true,
    json: async () => {
      if (url.endsWith('/repos/mj880616/work')) return { default_branch: 'main' };
      if (url.includes('/rulesets?')) return [{ id: 1 }, { id: 24278798 }];
      return rulesets[Number(url.split('/').pop())];
    },
  });
  const found = await findReadyMainRuleset({ repository: 'mj880616/work', token: 'test', fetchImpl });
  assert.equal(found.id, 24278798);
  assert.deepEqual(found.rejected.map(({ id }) => id), [1]);

  rulesets[24278798] = { ...applied(), id: 24278798, enforcement: 'disabled' };
  const none = await findReadyMainRuleset({ repository: 'mj880616/work', token: 'test', fetchImpl });
  assert.equal(none.id, null);
  assert.deepEqual(none.rejected[1].problems, ['enforcement is disabled']);
});

test('a skipped run from a title or body edit does not hide the real check result', async () => {
  const checkRuns = [
    { id: 10, name: 'loader-cache', status: 'completed', conclusion: 'success' },
    { id: 11, name: 'audit', status: 'completed', conclusion: 'failure' },
    { id: 20, name: 'loader-cache', status: 'completed', conclusion: 'skipped' },
    { id: 21, name: 'audit', status: 'completed', conclusion: 'skipped' },
  ];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ check_runs: checkRuns }) });
  const input = { repository: 'mj880616/work', head: 'abc', token: 'test', htmlChanged: true, maxAttempts: 1, fetchImpl };
  await assert.rejects(verifyNecessaryChecks(input), /audit failed/);
  checkRuns[1].conclusion = 'success';
  await verifyNecessaryChecks(input);
  checkRuns.splice(0, 2);
  await assert.rejects(verifyNecessaryChecks(input), /did not finish/);
});
