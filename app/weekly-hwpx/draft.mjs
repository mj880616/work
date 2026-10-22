// WEEKLY-한글초안 2단계: 업무일지 [주간 정리] → 주간보고 한글 파일(.hwpx). 화면 없는 부분(같은 코드를 시험이 그대로 부른다).
// 설계: docs/design/weekly-hwpx-draft.md 3·4·8절. AI 없음 — 지난주 확정본의 내 칸을 바탕으로, 이번 주 기록을 줄 옆에 보여 주고
// 사람이 붙이기·고치기 한다. 바탕과 다른 줄은 파란 글씨(W5). 파일 내용은 기기 안에서만 다룬다(서버로 보내지 않음, W6).
//
//   prepareConfirmed(pkg) → {team, template}: 확정본 읽기 + 빈 서식 뽑기 + 빈 서식 검사(확정본 글이 한 조각이라도 남으면 멈춤)
//   resolveMe(team, 프로필 이름) → 담당 팀원 칸의 내 이름(직전 확정본 표기 우선)
//   startDraft(team, {me, myOrgs, title, date}) → base(개인본 바탕, delta.mjs personalReportFromTeam)
//   editableRows(base, me) / editableOrgs(base) → 화면이 고칠 줄 목록
//   weekMaterial(model, rows, orgs) → 줄마다 이번 주 기록 후보, 짝 없는 기록
//   assembleDraft(base, edits) → 보고 자료(바뀐 줄 표시) → buildHwpx(template, data, zlib) → .hwpx 바이트(규격 검사 통과한 것만)
import {openHwpxAsync, packHwpxAsync, validateHwpxAsync} from './hwpx.mjs';
import {extractBlankTemplate, assertBlank} from './template.mjs';
import {readReport, buildReport, reportWords, lineText} from './report.mjs';
import {personalReportFromTeam, effectiveOwners, isMine, ownerNotation} from './delta.mjs';

// 브라우저 기본 압축(CompressionStream 'deflate-raw'). Node 20에도 있어 시험이 같은 길을 쓴다.
const pipe = (bytes, Kind) => new Response(new Blob([bytes]).stream().pipeThrough(new Kind('deflate-raw'))).arrayBuffer().then(b => new Uint8Array(b));
export const browserZlib = Object.freeze({
  deflateRawAsync: bytes => pipe(bytes, CompressionStream),
  inflateRawAsync: bytes => pipe(bytes, DecompressionStream),
});
export const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

const norm = s => String(s ?? '').replace(/\s+/g, '').replace(/[‧·․]/g, '·');
export const DRAFT_TEXT = Object.freeze({
  noSummary: '확정본에서 요약 표(사업영역 | 세부 과제 | 진행 상황 및 이후 계획 | 담당 팀원)를 찾지 못해 멈췄어요. 아무것도 만들지 않았어요.',
  notBlank: '확정본에서 빈 서식을 뽑았는데 원본 글이 남아 멈췄어요. 아무것도 만들지 않았어요.',
  noForm: '확정본에서 양식 표를 찾지 못해 멈췄어요. 아무것도 만들지 않았어요.',
  invalid: '만든 파일이 한글 파일 규격 검사를 통과하지 못해 내려받지 않았어요.',
});

export async function openConfirmed(bytes, zlib = browserZlib) { return openHwpxAsync(bytes, zlib); }

// 확정본 → {team(읽은 내용), template(빈 서식)}. 빈 서식 검사(template.mjs assertBlank)에 걸리면 Error(이유는 개수만, 글은 넣지 않음).
export function prepareConfirmed(pkg) {
  let team;
  try { team = readReport(pkg); } catch { throw Object.assign(new Error(DRAFT_TEXT.noSummary), {code: 'no_summary'}); }
  let template;
  // 양식 표(머리 칸 이름)를 찾지 못하면 멈춘다. 이유에는 양식 글자(표 머리 칸 이름)만 들어 있다.
  try { template = extractBlankTemplate(pkg); } catch (e) { throw Object.assign(new Error(`${DRAFT_TEXT.noForm} (${e.message})`), {code: 'no_form'}); }
  const problems = assertBlank(template, {forbidden: reportWords(team)});
  if (problems.length) throw Object.assign(new Error(DRAFT_TEXT.notBlank), {code: 'not_blank', count: problems.length});
  return {team, template};
}

// 보고 주 월요일 → "2026년 1월 5일(월)"
export function reportDate(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  const weekday = '일월화수목금토'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}년 ${m}월 ${d}일(${weekday})`;
}
export const fileNameFor = (day, ext = 'hwpx') => `주간보고_${String(day).replace(/-/g, '')}.${ext}`;

// 내 담당 조직 이름 목록(my-organizations.js selectMyOrganizations 결과 + 별칭). 이름 비교는 띄어쓰기 무시(delta.mjs isMyOrg).
export const orgNames = organizations => [...new Set(organizations.flatMap(o => [o.name, ...(Array.isArray(o.aliases) ? o.aliases : [])]).map(s => String(s ?? '').trim()).filter(Boolean))];

// 담당 팀원 칸의 내 이름: 직전 주 확정본 표기(delta.mjs ownerNotation), 없으면 프로필 이름(기존 경로). {me, from:'confirmed'|'profile'}
export function resolveMe(team, profileName) {
  const found = ownerNotation(team?.summary, profileName);
  return found ? {me: found, from: 'confirmed'} : {me: String(profileName ?? '').trim(), from: 'profile'};
}

export function startDraft(team, {me, myOrgs = [], title, date}) {
  return personalReportFromTeam(team, me, {myOrgs, title: title ?? team.title ?? '', date});
}

// 고칠 줄(내 담당 요약 표 줄). index = effectiveOwners 순서(assembleDraft가 같은 순서로 찾는다).
export function editableRows(base, me) {
  return effectiveOwners(base.summary).map((e, index) => ({index, area: e.area.join(' '), task: e.task.join(' '), mine: isMine(e.owner, me), lines: e.row.progress.map(lineText)}))
    .filter(r => r.mine).map(({mine, ...r}) => r);
}
export const editableOrgs = (base, section = 'orgs') => (base[section] ?? []).map((r, index) => ({index, org: r.org.join(' '), lines: r.status.map(lineText)}));

// 이번 주 기록을 줄 옆에. model = journal-weekly.js weeklySummary 결과.
// 요약: 사업영역·세부 과제 이름이 같은 줄(띄어쓰기·가운뎃점 무시)에 붙인다. 같은 세부 과제가 여러 줄이면 첫 줄에 보인다(사람이 옮김).
// 사업영역 줄 기록(1단)은 그 사업영역의 내 첫 줄에. 이름이 맞지 않는 기록은 unmatched(사람이 줄을 골라 붙임).
// 조직: 조직 이름(별칭 포함)이 같은 줄에.
export const candidateLine = item => `- ${item.issue && item.label ? `${item.label.split(' › ').slice(1).join(' › ')}: ` : ''}${item.text}`;
export function weekMaterial(model, rows, orgs, {aliases = new Map()} = {}) {
  const byRow = new Map(rows.map(r => [r.index, []]));
  const unmatched = [];
  const areas = model?.summary?.areas ?? [];
  for (const area of areas) for (const row of area.rows) for (const item of row.items) {
    const task = row.task?.name ?? '';
    const hit = rows.find(r => norm(r.area) === norm(area.name) && (task ? norm(r.task) === norm(task) : true));
    const line = {day: item.day, text: candidateLine(item), from: [area.name, task].filter(Boolean).join(' › ')};
    if (hit) byRow.get(hit.index).push(line); else unmatched.push(line);
  }
  for (const other of model?.summary?.others ?? []) for (const item of other.items) unmatched.push({day: item.day, text: `- ${item.text}`, from: other.name});
  const byOrg = new Map(orgs.map(o => [o.index, []]));
  const orgUnmatched = [];
  for (const section of model?.orgs?.sections ?? []) {
    const names = [section.name, ...(aliases.get(section.name) ?? [])].map(norm);
    const hit = orgs.find(o => names.includes(norm(o.org)));
    for (const item of section.items) {
      const line = {day: item.day, text: `- ${item.text}`, from: section.name};
      if (hit) byOrg.get(hit.index).push(line); else orgUnmatched.push(line);
    }
  }
  return {byRow, unmatched, byOrg, orgUnmatched};
}

// 화면에서 고친 줄 → 보고 자료. edits = {summary: Map(index → [줄]), orgs: Map(index → [줄]), sites: Map(…)}.
// 바탕(지난주 확정본의 내 칸)에 그대로 있는 줄은 검은 글씨, 그 밖의 줄(새 줄·고친 줄)은 파란 글씨. 빈 줄은 뺀다.
export function assembleDraft(base, edits = {}) {
  const out = structuredClone(base);
  const mark = (before, after) => {
    const kept = new Set(before.map(lineText));
    return after.map(s => String(s ?? '').replace(/\s+$/, '')).filter(s => s.trim()).map(text => (kept.has(text) ? text : {text, changed: true}));
  };
  const entries = effectiveOwners(out.summary);
  for (const [index, lines] of edits.summary ?? []) { const e = entries[index]; if (e) e.row.progress = mark(e.row.progress, lines); }
  for (const section of ['orgs', 'sites']) for (const [index, lines] of edits[section] ?? []) { const r = out[section]?.[index]; if (r) r.status = mark(r.status, lines); }
  return out;
}
export const changedCount = data => [...(data.summary ?? []).flatMap(a => a.rows.flatMap(r => r.progress)), ...(data.orgs ?? []).flatMap(r => r.status), ...(data.sites ?? []).flatMap(r => r.status)]
  .filter(l => typeof l === 'object' && l?.changed).length;

// 빈 서식 + 보고 자료 → .hwpx 바이트. 규격 검사(hwpx.mjs)를 통과하지 못하면 Error(파일을 내주지 않음).
export async function buildHwpx(template, data, zlib = browserZlib) {
  const {pkg} = buildReport(template, data);
  const bytes = await packHwpxAsync(pkg, zlib);
  const check = await validateHwpxAsync(bytes, zlib);
  if (check.errors.length) throw Object.assign(new Error(DRAFT_TEXT.invalid), {code: 'invalid', count: check.errors.length});
  return bytes;
}
