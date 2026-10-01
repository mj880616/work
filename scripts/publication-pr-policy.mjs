import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const datedDocument = /^press\/\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\/(?:index\.html|[^/\\]+\.(?:hwp|hwpx|pdf))$/;

export function classifyPublicationPaths(paths) {
  const outside = paths.filter(path =>
    path !== 'press/archive.json' &&
    path !== 'press/index.html' &&
    !datedDocument.test(path));
  return { publication: paths.length > 0 && outside.length === 0, outside };
}

export function isTrustedPublicationAuthor(pr, repository) {
  const owner = repository.split('/')[0]?.toLowerCase();
  return pr.base?.ref === 'main' &&
    pr.base?.repo?.full_name?.toLowerCase() === repository.toLowerCase() &&
    pr.head?.repo?.full_name?.toLowerCase() === repository.toLowerCase() &&
    pr.user?.login?.toLowerCase() === owner;
}

async function requestJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub API failed (${response.status ?? 'unknown'})`);
  return response.json();
}

export async function readPullRequestSnapshot({ repository, number, expectedHead, token, fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !Number.isSafeInteger(Number(number)) || !token) {
    throw new Error('Missing or invalid PR API input');
  }
  const root = `https://api.github.com/repos/${repository}/pulls/${number}`;
  const pr = await requestJson(root, token, fetchImpl);
  if (pr.head?.sha !== expectedHead) throw new Error('PR head changed during classification');
  if (!Number.isSafeInteger(pr.changed_files) || pr.changed_files < 1 || pr.changed_files > 3000) {
    throw new Error('PR file count cannot be verified');
  }
  const paths = [];
  let fileCount = 0;
  for (let page = 1; page <= 31; page += 1) {
    const files = await requestJson(`${root}/files?per_page=100&page=${page}`, token, fetchImpl);
    if (!Array.isArray(files)) throw new Error('PR file list is invalid');
    for (const file of files) {
      if (typeof file.filename !== 'string') throw new Error('PR file path is invalid');
      if (file.status === 'renamed' && typeof file.previous_filename !== 'string') {
        throw new Error('Renamed PR file lacks its original path');
      }
      fileCount += 1;
      paths.push(file.filename);
      if (file.previous_filename !== undefined) {
        if (typeof file.previous_filename !== 'string') throw new Error('Original PR file path is invalid');
        paths.push(file.previous_filename);
      }
    }
    if (files.length < 100) break;
  }
  if (fileCount !== pr.changed_files) throw new Error('PR file count does not match API inventory');
  return { pr, paths };
}

export const MAIN_REQUIRED_CHECKS = ['publication-gate', 'dropzone'];
const GITHUB_ACTIONS_APP_ID = 15368;

// Judges a ruleset by what it enforces, not by its name. Bypass actors are only
// returned to tokens that can edit rulesets; when hidden they are reported as a
// warning and must be confirmed with an administrator API read.
export function evaluateMainRuleset(ruleset, defaultBranch) {
  const problems = [];
  const warnings = [];
  if (defaultBranch !== 'main') problems.push(`default branch is ${defaultBranch}, not main`);
  if (ruleset?.target !== 'branch') problems.push('target is not branch');
  if (ruleset?.enforcement !== 'active') problems.push(`enforcement is ${ruleset?.enforcement}`);
  const include = ruleset?.conditions?.ref_name?.include ?? [];
  const exclude = ruleset?.conditions?.ref_name?.exclude ?? [];
  if (!include.some(ref => ref === '~DEFAULT_BRANCH' || ref === 'refs/heads/main')) problems.push('does not target main');
  if (exclude.length > 0) problems.push('has branch exclusions');
  if (Array.isArray(ruleset?.bypass_actors)) {
    if (ruleset.bypass_actors.length > 0) problems.push('has bypass actors');
  } else {
    warnings.push('bypass actors are not visible to this token');
  }
  if (ruleset?.current_user_can_bypass !== undefined && ruleset.current_user_can_bypass !== 'never') {
    problems.push('workflow token can bypass');
  }
  const rules = Array.isArray(ruleset?.rules) ? ruleset.rules : [];
  for (const type of ['deletion', 'non_fast_forward', 'pull_request']) {
    if (!rules.some(rule => rule?.type === type)) problems.push(`missing ${type} rule`);
  }
  const checks = rules
    .filter(rule => rule?.type === 'required_status_checks')
    .flatMap(rule => rule.parameters?.required_status_checks ?? []);
  for (const context of MAIN_REQUIRED_CHECKS) {
    if (!checks.some(check => check?.context === context && check?.integration_id === GITHUB_ACTIONS_APP_ID)) {
      problems.push(`missing required check ${context}`);
    }
  }
  return { ready: problems.length === 0, problems, warnings };
}

export async function findReadyMainRuleset({ repository, token, fetchImpl = fetch }) {
  const root = `https://api.github.com/repos/${repository}`;
  const repo = await requestJson(root, token, fetchImpl);
  const list = await requestJson(`${root}/rulesets?per_page=100`, token, fetchImpl);
  if (!Array.isArray(list)) throw new Error('Ruleset inventory is invalid');
  const rejected = [];
  for (const summary of list) {
    if (!Number.isSafeInteger(summary?.id)) throw new Error('Ruleset id is invalid');
    const ruleset = await requestJson(`${root}/rulesets/${summary.id}`, token, fetchImpl);
    const result = evaluateMainRuleset(ruleset, repo.default_branch);
    if (result.ready) return { id: ruleset.id, name: ruleset.name, warnings: result.warnings, rejected };
    rejected.push({ id: ruleset.id, name: ruleset.name, problems: result.problems });
  }
  return { id: null, rejected };
}

export async function verifyNecessaryChecks({ repository, head, token, htmlChanged, maxAttempts = 20, fetchImpl = fetch }) {
  const required = htmlChanged ? ['loader-cache', 'audit'] : ['loader-cache'];
  const url = `https://api.github.com/repos/${repository}/commits/${head}/check-runs?per_page=100`;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const data = await requestJson(url, token, fetchImpl);
    if (!Array.isArray(data.check_runs)) throw new Error('Check run inventory is invalid');
    const latest = new Map();
    for (const run of data.check_runs) {
      // A title or body edit records a skipped run; it must not hide the real result.
      if (run.conclusion === 'skipped') continue;
      if (!latest.has(run.name) || run.id > latest.get(run.name).id) latest.set(run.name, run);
    }
    for (const name of required) {
      const run = latest.get(name);
      if (run?.status === 'completed' && run.conclusion !== 'success') throw new Error(`${name} failed: ${run.conclusion}`);
    }
    if (required.every(name => latest.get(name)?.status === 'completed' && latest.get(name)?.conclusion === 'success')) return;
    if (attempt + 1 < maxAttempts) await new Promise(resolve => setTimeout(resolve, 15000));
  }
  throw new Error(`Required publication checks did not finish: ${required.join(', ')}`);
}

function writeOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const number = Number(process.env.PR_NUMBER);
  const expectedHead = process.env.EXPECTED_HEAD_SHA;
  const token = process.env.GITHUB_TOKEN;
  const mode = process.argv[2] ?? 'classify';

  if (mode === 'wait-disabled') {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const { pr } = await readPullRequestSnapshot({ repository, number, expectedHead, token });
      if (pr.merged_at) throw new Error('PR merged before automatic merge was disabled');
      if (pr.auto_merge === null) return;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    throw new Error('Automatic merge is still enabled for a non-publication PR');
  }

  if (mode === 'wait-checks') {
    const { paths } = await readPullRequestSnapshot({ repository, number, expectedHead, token });
    if (!classifyPublicationPaths(paths).publication) throw new Error('PR is no longer publication-only');
    await verifyNecessaryChecks({ repository, head: expectedHead, token, htmlChanged: paths.some(path => path.endsWith('.html')) });
    return;
  }

  if (mode === 'ruleset-ready') {
    const found = await findReadyMainRuleset({ repository, token });
    for (const { id, name, problems } of found.rejected) {
      console.log(`Ruleset ${id} (${name}) not accepted: ${problems.join('; ')}`);
    }
    if (found.id === null) throw new Error('No active ruleset protects main with the publication gate; no reservation made.');
    for (const warning of found.warnings) console.log(`::warning::Ruleset ${found.id}: ${warning}`);
    console.log(`Main ruleset ${found.id} (${found.name}) meets the publication requirements.`);
    return;
  }

  if (mode !== 'classify') throw new Error(`Unknown mode: ${mode}`);
  const { pr, paths } = await readPullRequestSnapshot({ repository, number, expectedHead, token });
  const result = classifyPublicationPaths(paths);
  const trusted = isTrustedPublicationAuthor(pr, repository);
  const autoEligible = result.publication && trusted && pr.state === 'open' && !pr.draft;
  writeOutput('publication', result.publication);
  writeOutput('auto_eligible', autoEligible);
  writeOutput('trusted_author', trusted);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Publication classification\n\n- Publication content only: ${result.publication}\n- Internal owner PR: ${trusted}\n- Outside paths: ${result.outside.length ? result.outside.map(path => `\`${path.replaceAll('`', '')}\``).join(', ') : 'none'}\n`);
  }
  console.log(JSON.stringify({ publication: result.publication, autoEligible, outside: result.outside }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
