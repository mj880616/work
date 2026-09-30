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

export async function verifyNecessaryChecks({ repository, head, token, htmlChanged, maxAttempts = 20, fetchImpl = fetch }) {
  const required = htmlChanged ? ['loader-cache', 'audit'] : ['loader-cache'];
  const url = `https://api.github.com/repos/${repository}/commits/${head}/check-runs?per_page=100`;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const data = await requestJson(url, token, fetchImpl);
    if (!Array.isArray(data.check_runs)) throw new Error('Check run inventory is invalid');
    const latest = new Map();
    for (const run of data.check_runs) {
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
