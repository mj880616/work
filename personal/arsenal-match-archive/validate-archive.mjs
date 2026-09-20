import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const archivePath = new URL('./matches.js', import.meta.url);
const premierRounds = new Set(Array.from({ length: 38 }, (_, i) => `${i + 1}R`));
const uclRounds = new Set([
  ...Array.from({ length: 8 }, (_, i) => `League Phase MD${i + 1}`),
  'Round of 16 1st Leg', 'Round of 16 2nd Leg',
  'Quarter-final 1st Leg', 'Quarter-final 2nd Leg',
  'Semi-final 1st Leg', 'Semi-final 2nd Leg', 'Final'
]);
// Exact factual corrections to the pre-existing Ipswich review; all other 2026-27 text remains guarded.
const ipswichAssistCorrections = new Map([
  ['16분 마두에케 골(메리노 도움)', '16분 마두에케 골(메리노 패스·공식 도움 배정 없음)'],
  ['58분 메리노 골(다우먼 도움)', '58분 메리노 골(다우먼 연결·공식 도움 배정 없음)'],
  [
    '브루노-메리노 중원이 경기 초반 세컨드볼과 전진 패스를 장악해 입스위치가 압박을 지속하지 못하게 했고, 메리노는 1골 1도움으로 공격 마무리까지 담당했음.',
    '브루노-메리노 중원이 경기 초반 세컨드볼과 전진 패스를 장악해 입스위치가 압박을 지속하지 못하게 했고, 메리노는 1골과 16분 추가골의 마지막 패스로 공격 마무리까지 관여했음. 공식 이벤트에서는 해당 패스에 도움을 배정하지 않았음.'
  ]
]);

const validDate = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const isHttps = value => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
};

export function loadArchive(sourceText) {
  const window = {};
  runInNewContext(sourceText, { window }, { timeout: 1000 });
  if (!Array.isArray(window.ARSENAL_MATCHES)) {
    throw new Error('matches.js must assign an array to window.ARSENAL_MATCHES');
  }
  return JSON.parse(JSON.stringify(window.ARSENAL_MATCHES));
}

export function auditArchive(matches, { complete = true, baselineMatches } = {}) {
  const errors = [];
  if (!Array.isArray(matches)) {
    return { counts: { premierLeague: 0, championsLeague: 0, total: 0 }, errors: ['matches must be an array'] };
  }

  const ids = new Set();
  const identities = new Set();
  const premierSeen = new Set();
  const uclSeen = new Set();
  const seasonMatches = [];

  for (const [index, match] of matches.entries()) {
    if (!match || typeof match !== 'object') {
      errors.push(`record ${index}: invalid match object`);
      continue;
    }
    const name = match.id || `record ${index}`;
    if (typeof match.id !== 'string' || !match.id.trim()) errors.push(`${name}: missing id`);
    else if (ids.has(match.id)) errors.push(`${name}: duplicate id`);
    else ids.add(match.id);
    if (!validDate(match.date)) errors.push(`${name}: invalid date`);
    for (const field of ['goalsSource', 'goalsTimeSource']) {
      if (match[field] !== undefined && !isHttps(match[field])) {
        errors.push(`${name}: invalid scoring source URL (${field})`);
      }
    }

    if (match.season !== '2025-26') continue;
    seasonMatches.push(match);
    if (match.competition !== 'Premier League' && match.competition !== 'UEFA Champions League') {
      errors.push(`${name}: invalid competition`);
      continue;
    }
    const permitted = match.competition === 'Premier League' ? premierRounds : uclRounds;
    const seen = match.competition === 'Premier League' ? premierSeen : uclSeen;
    if (!permitted.has(match.round)) errors.push(`${name}: invalid round`);
    else if (seen.has(match.round)) errors.push(`${name}: duplicate round`);
    else seen.add(match.round);
    const identity = [match.season, match.competition, match.round].join('|');
    if (identities.has(identity)) errors.push(`${name}: duplicate match identity`);
    else identities.add(identity);

    for (const field of ['venue', 'home', 'away', 'result', 'title', 'subtitle', 'verdict']) {
      if (typeof match[field] !== 'string' || !match[field].trim()) errors.push(`${name}: missing ${field}`);
    }
    if (match.home !== '아스날' && match.away !== '아스날') errors.push(`${name}: Arsenal is neither home nor away`);
    if (!['승', '무', '패'].includes(match.result)) errors.push(`${name}: invalid result`);
    for (const field of ['homeScore', 'awayScore']) {
      if (!Number.isInteger(match[field]) || match[field] < 0) errors.push(`${name}: invalid ${field}`);
    }
    for (const field of ['summary', 'decisive', 'arteta', 'nextWatch']) {
      if (!Array.isArray(match[field]) || match[field].length < 3 || match[field].some(x => typeof x !== 'string' || !x.trim())) {
        errors.push(`${name}: invalid ${field}`);
      }
    }
    for (const field of ['stats', 'opponentStats']) {
      if (!match[field] || typeof match[field] !== 'object' ||
          ['possession', 'shots', 'xg', 'bigChances'].some(key => typeof match[field][key] !== 'string' || !match[field][key].trim())) {
        errors.push(`${name}: invalid ${field}`);
      }
    }
    if (!Array.isArray(match.sources) || match.sources.length < 2 ||
        new Set(match.sources.map(source => source?.url)).size !== match.sources.length ||
        match.sources.some(source => !source || typeof source.label !== 'string' || !source.label.trim() || !isHttps(source.url))) {
      errors.push(`${name}: invalid or duplicate source URL`);
    }
    if (match.media !== undefined && (!Array.isArray(match.media) ||
        match.media.some(item => !item || typeof item.label !== 'string' || !item.label.trim() || !isHttps(item.url)))) {
      errors.push(`${name}: invalid media URL`);
    }
  }

  const counts = {
    premierLeague: seasonMatches.filter(match => match.competition === 'Premier League').length,
    championsLeague: seasonMatches.filter(match => match.competition === 'UEFA Champions League').length,
    total: seasonMatches.length
  };
  const targets = { premierLeague: 38, championsLeague: 15, total: 53 };
  for (const [key, target] of Object.entries(targets)) {
    if (complete ? counts[key] !== target : counts[key] > target) {
      errors.push(`${key}: ${counts[key]}/${target}`);
    }
  }
  if (baselineMatches) {
    const recent = list => list.filter(match => match?.season === '2026-27');
    const baselineRecent = recent(baselineMatches);
    const scoringFields = new Set(['goals', 'goalsSource', 'goalsTimeSource']);
    const comparableRecent = recent(matches).map((match, index) => {
      const baseline = baselineRecent[index];
      if (!baseline || baseline.id !== match.id) return match;
      const comparable = Object.fromEntries(Object.entries(match).filter(([key]) =>
        !scoringFields.has(key) || Object.hasOwn(baseline, key)));
      if (match.id === '2026-09-15-ipswich-away-carabao') {
        for (const field of ['events', 'decisive']) {
          if (!Array.isArray(comparable[field])) continue;
          comparable[field] = comparable[field].map((text, position) => {
            const oldText = baseline[field]?.[position];
            return ipswichAssistCorrections.get(oldText) === text ? oldText : text;
          });
        }
      }
      return comparable;
    });
    if (JSON.stringify(comparableRecent) !== JSON.stringify(baselineRecent)) {
      errors.push('2026-27 records differ from baseline');
    }
  }
  return { counts, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const partial = args.includes('--partial');
  const baselineAt = args.indexOf('--baseline-ref');
  if (baselineAt >= 0 && !args[baselineAt + 1]) throw new Error('--baseline-ref requires a git ref');
  const baselineMatches = baselineAt < 0 ? undefined : loadArchive(execFileSync('git', [
    'show', `${args[baselineAt + 1]}:personal/arsenal-match-archive/matches.js`
  ], { encoding: 'utf8' }));
  const result = auditArchive(loadArchive(readFileSync(archivePath, 'utf8')), {
    complete: !partial,
    baselineMatches
  });
  console.log(`EPL ${result.counts.premierLeague}/38, UCL ${result.counts.championsLeague}/15, total ${result.counts.total}/53`);
  for (const error of result.errors) console.error(error);
  if (result.errors.length) process.exitCode = 1;
}
