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
import {matchOrgs, matchOrg, orgAllNames, sameOrgName} from '../org-name-match.mjs';
import {personalReportFromTeam, effectiveOwners, isMine, ownerNotation} from './delta.mjs';
import {sitePlan, isStageLine, stageOfOrg, weekOf} from '../org-dispute-stage-model.mjs';
import {issuedFromSections} from '../weekly-lines.mjs';

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

// WEEKLY-개인본대조 W-2: 내준 한글 파일(.hwpx 바이트)의 1~4절 글 줄을 draft.issued 모양으로(weekly-lines.mjs — 서버가 개인본을 읽는 것과 같은 함수).
// 5절·'2) 주요 일정'·표 머리 칸 이름은 빠진다. 읽을 줄이 없거나 너무 길면 null.
export async function issuedFrom(bytes, at, zlib = browserZlib) {
  const pkg = await openHwpxAsync(bytes, zlib);
  const sections = pkg.order.map(name => ({name, n: Number(/^Contents\/section(\d{1,4})\.xml$/i.exec(name)?.[1])})).filter(x => Number.isInteger(x.n)).sort((a, b) => a.n - b.n);
  const dec = new TextDecoder();
  return issuedFromSections(sections.map(x => dec.decode(pkg.files.get(x.name))), at);
}

// WEEKLY-한글파일다듬기 ②(2026-10-23 사용자 지적 11:38): 바탕 파일이 .hwp면 칸막이 편집기 엔진(rhwp 0.8.7 WASM, hwp-frame.js)이 .hwpx로 바꾼다.
// 엔진이 열지 못하는 파일은 미리 알아본다(엔진에 넣으면 암호 묻는 창이 숨은 칸막이 안에서 답을 기다리다 시간 초과로 끝난다).
//   'hwpx' = ZIP(PK) 묶음(확장자가 .hwp여도 내용이 HWPX면 엔진 없이 연다), 'hwp5' = HWP 5(OLE 묶음), 'hwp3' = HWP 3.0 이하(엔진 미지원),
//   null = 한글 파일이 아님. HWP 5는 FileHeader 속성(암호·배포용)도 읽는다(OLE 묶음 안 작은 스트림, 아래 hwp5Header).
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const HWP_SIGNATURE = 'HWP Document File';
const startsWith = (bytes, sig) => sig.every((b, i) => bytes[i] === b);
const ascii = (bytes, at, n) => String.fromCharCode(...bytes.subarray(at, at + n));
export function hwpKind(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'hwpx';
  if (b.length >= 512 && startsWith(b, OLE)) return 'hwp5';
  if (b.length >= 32 && ascii(b, 0, HWP_SIGNATURE.length) === HWP_SIGNATURE) return 'hwp3';
  return null;
}
// 엔진이 바꾸지 못한 이유(짧은 말 — 화면 안내 끝 괄호, 다음 보고에서 원인을 좁히려고). 오류 글 자체는 보이지 않는다(파일 내용이 들 수 있음).
export function engineReason(error) {
  const text = String(error?.message ?? error ?? '');
  if (/timeout|시간/i.test(text)) return '시간 초과';
  if (/편집기|Editor|initiali|불러오지|connect|destroyed/i.test(text)) return '변환기를 불러오지 못함';
  return '파일을 열지 못함';
}
// HWP 5 FileHeader(256바이트: 서명 32 + 판 4 + 속성 4 …). 속성 비트 1 = 암호, 비트 2 = 배포용. 읽지 못하면 null(그래도 엔진에 맡김).
// OLE(Compound File) 최소 읽기: 머리 → FAT(DIFAT) → 디렉터리에서 'FileHeader' → 4096바이트 미만이라 작은 스트림(mini stream)에서 읽는다.
export function hwp5Header(bytes) {
  try {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (hwpKind(b) !== 'hwp5') return null;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const u16 = at => v.getUint16(at, true), u32 = at => v.getUint32(at, true);
    const size = 1 << u16(0x1e), mini = 1 << u16(0x20), cutoff = u32(0x38);
    if (![512, 4096].includes(size) || mini !== 64) return null;
    const sector = n => (n + 1) * size;
    const END = 0xfffffffe, LIMIT = 1 << 16;
    const fatSectors = [];
    for (let i = 0; i < 109 && fatSectors.length < u32(0x2c); i++) fatSectors.push(u32(0x4c + i * 4));
    for (let d = u32(0x44), guard = 0; d < END && fatSectors.length < u32(0x2c) && guard < LIMIT; guard++) {
      for (let i = 0; i < size / 4 - 1 && fatSectors.length < u32(0x2c); i++) fatSectors.push(u32(sector(d) + i * 4));
      d = u32(sector(d) + size - 4);
    }
    const fat = n => { const per = size / 4, s = fatSectors[Math.floor(n / per)]; return s === undefined || sector(s) + size > b.length ? END : u32(sector(s) + (n % per) * 4); };
    const chain = start => { const out = []; for (let n = start, g = 0; n < END && g < LIMIT; n = fat(n), g++) { if (sector(n) + size > b.length) return null; out.push(n); } return out; };
    const read = (start, length) => { const c = chain(start); if (!c) return null; const out = new Uint8Array(c.length * size); c.forEach((n, i) => out.set(b.subarray(sector(n), sector(n) + size), i * size)); return out.subarray(0, length); };
    const dirs = chain(u32(0x30));
    if (!dirs?.length) return null;
    const entries = [];
    for (const n of dirs) for (let at = sector(n); at < sector(n) + size; at += 128) {
      const len = u16(at + 0x40);
      const name = len >= 2 && len <= 64 ? new TextDecoder('utf-16le').decode(b.subarray(at, at + len - 2)) : '';
      entries.push({name, type: b[at + 0x42], start: u32(at + 0x74), size: u32(at + 0x78)});
    }
    const root = entries[0], file = entries.find(e => e.type === 2 && e.name === 'FileHeader');
    if (!root || root.type !== 5 || !file || file.size < 40) return null;
    let data;
    if (file.size >= cutoff) data = read(file.start, file.size);
    else {
      const stream = read(root.start, root.size), minifat = read(u32(0x3c), u32(0x40) * size);
      if (!stream || !minifat) return null;
      const mv = new DataView(minifat.buffer, minifat.byteOffset, minifat.byteLength);
      data = new Uint8Array(Math.ceil(file.size / mini) * mini);
      let k = 0;
      for (let n = file.start, g = 0; n < END && g < LIMIT && k < data.length; n = (n * 4 + 4 <= mv.byteLength ? mv.getUint32(n * 4, true) : END), g++) {
        if ((n + 1) * mini > stream.length) return null;
        data.set(stream.subarray(n * mini, (n + 1) * mini), k); k += mini;
      }
      data = data.subarray(0, file.size);
    }
    if (!data || data.length < 40 || ascii(data, 0, HWP_SIGNATURE.length) !== HWP_SIGNATURE) return null;
    const props = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(36, true);
    const version = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(32, true);
    return {major: version >>> 24, password: !!(props & 2), distribution: !!(props & 4)};
  } catch { return null; }
}

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
// WEEKLY-한글파일다듬기 ④(2026-10-23 사용자 요청 12:12): 파일 이름 = 주간보고_YYYYMMDD_이름.hwpx(날짜 = 상집 보고일, 이름 = 로그인 사용자의
// 표시 이름 — 프로필 display_name, 없으면 로그인 정보의 표시 이름). 이름이 없으면 주간보고_YYYYMMDD.hwpx. 파일 이름에 쓸 수 없는 글자와
// 띄어쓰기는 뺀다(PC·폰 내려받기와 Drive에서 같은 이름이 되게). [HWP로 받기]·[확정] 저장도 같은 이름(.hwp는 확장자만 다름).
export const fileNamePart = name => String(name ?? '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '').replace(/\s+/g, '').replace(/^\.+|\.+$/g, '').slice(0, 40);
export const fileNameFor = (day, name = '', ext = 'hwpx') => {
  const who = fileNamePart(name);
  return `주간보고_${String(day).replace(/-/g, '')}${who ? `_${who}` : ''}.${ext}`;
};

// WEEKLY-한글파일다듬기 ③(2026-10-23 사용자 지적 12:02 ②): '줄을 찾지 못한 이번 주 기록'의 붙일 줄 기본값. 전에는 고르기 칸에 빈 값이 없어
// 브라우저가 목록 첫 줄(조직이면 가나다순 첫 조직, 요약이면 첫 사업 줄)을 골라 두었다. 이제 이름이 가장 가까운 줄 하나만 기본으로 고르고,
// 맞는 줄이 없거나 둘 이상이 같은 만큼 맞으면 ''(줄 고르기). 이름 비교: 띄어쓰기·문장부호 무시, 같거나 한쪽이 다른 쪽을 품으면(짧은 쪽 3자 이상) 맞음.
// from = 기록이 온 곳("사업영역 › 세부 과제" 또는 조직 이름), targets = [{value, names:[사업영역, 세부 과제] 또는 [조직 이름, 별칭…]}].
// 요약 줄은 세부 과제(끝 이름)가 맞으면 2점, 사업영역(앞 이름)이 맞으면 1점. 조직 약칭(…노조 ↔ …노동조합)은 ORG-별칭 과제에서 별칭으로 잇는다.
const nameKey = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/[\s·‧․.,()[\]{}<>「」『』'"“”‘’\-–_/]/g, '');
const sameOrWithin = (a, b) => !!a && !!b && (a === b || (Math.min([...a].length, [...b].length) >= 3 && (a.includes(b) || b.includes(a))));
// 확정본 조직 줄 이름 → 붙일 줄 후보의 이름들: 줄에 적힌 이름 + (줄이 내 담당 조직 하나에 딱 맞으면) 그 조직의 정식 이름·별칭.
export const rowNames = (rowText, organizations) => {
  const org = matchOrg(rowText, organizations);
  return [...new Set([String(rowText ?? ''), ...(org ? orgAllNames(org) : [])])];
};
export function nearestTarget(from, targets) {
  const parts = String(from ?? '').split('›').map(nameKey).filter(Boolean);
  if (!parts.length) return '';
  const last = parts.at(-1), first = parts.length > 1 ? parts[0] : null;
  // 조직 줄(ORG-별칭): 정식 이름·별칭·자동 규칙(org-name-match.mjs)으로 딱 한 곳이 맞으면 그 줄, 둘 이상 맞으면 자동으로 고르지 않는다(''). 하나도 안 맞을 때만 아래 '품으면 맞음'.
  const orgTargets = targets.filter(t => t.kind === 'org');
  if (orgTargets.length) {
    const orgs = orgTargets.map(t => ({value: t.value, name: (t.names ?? [])[0] ?? '', aliases: (t.names ?? []).slice(1)}));
    const hits = new Map();
    for (const raw of String(from ?? '').split('›')) for (const o of matchOrgs(raw.trim(), orgs)) hits.set(o.value, o);
    // 같은 조직 줄이 확정본에 여럿이면(이름이 같거나 자동 규칙으로 같음) 첫 줄. 서로 다른 조직 둘 이상이면 고르지 않음.
    const found = [...hits.values()];
    if (found.length && found.every(o => sameOrgName(o.name, found[0].name))) return found[0].value;
    if (found.length) return '';
  }
  const scored = targets.map(t => {
    const names = (t.names ?? []).map(nameKey).filter(Boolean);
    if (t.kind === 'row') {
      const [area, task] = names.length > 1 ? [names[0], names.at(-1)] : [null, names[0]];
      const score = (sameOrWithin(last, task) ? 2 : 0) + (first && sameOrWithin(first, area) ? 1 : 0) + (!first && sameOrWithin(last, area) ? 1 : 0);
      return {value: t.value, score};
    }
    return {value: t.value, score: names.some(n => parts.some(p => sameOrWithin(p, n))) ? 2 : 0};
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) return '';
  return scored[0].value;
}

// WEEKLY-한글파일다듬기 ⑤(2026-10-23 사용자 요청 12:43 ⑥): 바탕(지난주 확정본) 줄 가운데 보고일 기준 이미 지난 날짜의 '…예정'은 '예정'만 뺀다
// ('완료'를 붙이지 않음: '제출 예정' → '제출', '(예정)'도 뺌). 줄의 날짜(M.D·M/D·M월 D일, 앞에 연도가 있어도 됨, '10.20~22'처럼 끝 날만 쓴 기간 포함)
// 가운데 가장 늦은 날이 보고일보다 앞일 때만 고친다(보고일 당일·날짜 없는 줄·'예정대로'·'예정임' 같은 말은 그대로). 연도는 보고일에 가장 가까운 해.
const pad2 = n => String(n).padStart(2, '0');
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
function nearDay(y, m, d, near) {
  if (y) { const s = `${y}-${pad2(m)}-${pad2(d)}`; return isDay(s) ? s : null; }
  const base = Number(near.slice(0, 4)), at = Date.parse(`${near}T00:00:00Z`);
  let best = null;
  for (const yy of [base - 1, base, base + 1]) {
    const s = `${yy}-${pad2(m)}-${pad2(d)}`;
    if (isDay(s) && (!best || Math.abs(Date.parse(`${s}T00:00:00Z`) - at) < best.gap)) best = {s, gap: Math.abs(Date.parse(`${s}T00:00:00Z`) - at)};
  }
  return best?.s ?? null;
}
export function lineDays(text, near) {
  const out = [], src = String(text ?? '');
  const dated = /(?<![\d.])(?:(20\d{2})\s*[./년]\s*)?(\d{1,2})\s*(?:[./]|월\s*)\s*(\d{1,2})\s*일?(?:\s*[~\-–～]\s*(?:(\d{1,2})\s*[./월]\s*)?(\d{1,2})(?![\d:]))?(?![\d:])/g;
  let m;
  while ((m = dated.exec(src))) {
    const [, y, mo, d, mo2, d2] = m;
    const a = Number(mo), b = Number(d);
    if (a < 1 || a > 12 || b < 1 || b > 31) continue;
    const first = nearDay(y ? Number(y) : null, a, b, near);
    if (first) out.push(first);
    if (d2) { const end = nearDay(y ? Number(y) : null, mo2 ? Number(mo2) : a, Number(d2), first ?? near); if (end && (!first || end >= first)) out.push(end); }
  }
  return out;
}
const PLAN = /\s*\(\s*예정\s*\)|\s*예정(?=$|[\s.,·;:()\]」』])/g;
export function dropPastPlan(line, reportDay) {
  const text = String(line ?? '');
  if (!isDay(String(reportDay)) || !/예정/.test(text)) return text;
  const days = lineDays(text, String(reportDay));
  if (!days.length || days.reduce((a, b) => (a > b ? a : b)) >= reportDay) return text;
  const next = text.replace(PLAN, '').replace(/\s+$/, '');
  return next.trim() ? next : text;
}
// 고칠 줄 묶음(rows·orgs·sites의 lines)에 적용 → {lines, changed:[{from, to}]}
export function pastPlanLines(lines, reportDay) {
  const changed = [];
  const out = lines.map(line => { const to = dropPastPlan(line, reportDay); if (to !== line) changed.push({from: line, to}); return to; });
  return {lines: out, changed};
}

// 내 담당 조직 이름 목록(my-organizations.js selectMyOrganizations 결과 + 별칭). 이름 비교는 띄어쓰기 무시(delta.mjs isMyOrg).
export const orgNames = organizations => [...new Set(organizations.flatMap(o => [o.name, ...(Array.isArray(o.aliases) ? o.aliases : [])]).map(s => String(s ?? '').trim()).filter(Boolean))];

// 담당 팀원 칸의 내 이름: 직전 주 확정본 표기(delta.mjs ownerNotation), 없으면 프로필 이름(기존 경로). {me, from:'confirmed'|'profile'}
export function resolveMe(team, profileName) {
  const found = ownerNotation(team?.summary, profileName);
  return found ? {me: found, from: 'confirmed'} : {me: String(profileName ?? '').trim(), from: 'profile'};
}

// orgList(선택): 내 담당 조직 [{name, aliases}] — 주면 4. 산하조직 현황 표에 그 조직 전부를 조직보고 순서로 둔다(delta.mjs allOrgRows).
export function startDraft(team, {me, myOrgs = [], orgList = null, title, date}) {
  return personalReportFromTeam(team, me, {myOrgs, orgList, title: title ?? team.title ?? '', date});
}

// ORG-쟁의단계 ②(2026-10-24 명진 결정): 3. 2) 투쟁 사업장 현황을 쟁의 단계에서 채운다. 판정은 org-dispute-stage-model.mjs 한 곳.
//   - 투쟁 중인 내 담당 조직: 첫 줄 '- 쟁의발생 결의(10.20)'(단계(날짜), 파란 글씨) + 직전 확정본의 그 조직 현황 줄 그대로(앱이 이전에 채운 단계 줄만 새 줄로 바꿈).
//     확정본에 줄이 없던 조직은 새 줄(조직명 + 첫 줄)을 표 끝에 더한다.
//   - 이번 보고 주간에 끝난(끝남 표시 단계) 조직: 그 주 한 번만 '- 협약체결(10.24)' 한 줄. 다음 주부터는 단계가 지난 주라 빠진다.
//   - 직전 확정본에 줄이 있었는데 더는 투쟁 중이 아니면 말없이 지우지 않고 fixes(고칠 목록 '지울까요?')로 알린다. 줄 자체는 그대로 둔다.
// 단계를 읽지 못했으면(state.status !== 'ready') 아무것도 바꾸지 않는다(기존처럼 직전 확정본 줄 그대로).
// 반환 {base(새 줄이 더해진 바탕), starts: Map(줄 번호 → 시작 줄들), fixes:[{index, org, stage}], plan}
export function applySiteStages(base, {orgs = [], stages = [], histories = new Map(), weekStart} = {}) {
  const none = {base, starts: new Map(), fixes: [], plan: []};
  if (!weekStart || !orgs.length || !stages.length) return none;
  const week = weekOf(weekStart);
  const out = structuredClone(base);
  const rows = out.sites ?? (out.sites = []);
  const plan = sitePlan(orgs, histories, stages, week);
  const starts = new Map(), claimed = new Set();
  const rowOf = org => rows.findIndex((r, i) => !claimed.has(i) && matchOrgs([].concat(r.org).join(''), [org]).length > 0);
  for (const item of plan) {
    let index = rowOf(item.org);
    if (index < 0) { rows.push({org: [String(item.org.name ?? '').trim()], status: [], paras: []}); index = rows.length - 1; }
    claimed.add(index);
    const old = rows[index].status.map(lineText);
    starts.set(index, item.kind === 'ended' ? [item.line] : [item.line, ...old.filter(t => !isStageLine(t, stages))]);
  }
  const fixes = [];
  rows.forEach((r, index) => {
    if (claimed.has(index) || !r.status.map(lineText).some(t => String(t).trim())) return;
    const org = orgs.find(o => matchOrgs([].concat(r.org).join(''), [o]).length > 0);
    const cur = org ? stageOfOrg(org.id, histories, stages, {until: week.end}) : null;
    fixes.push({index, org: [].concat(r.org).join(' '), stage: cur?.name ?? ''});
  });
  return {base: out, starts, fixes, plan};
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
function matchSectionRow(name, aliasList, rows, sections) {
  const me = {name, aliases: aliasList};
  const found = rows.filter(r => matchOrgs(r.org, [me]).length);
  if (!found.length) return null;
  const same = found.every(r => sameOrgName(r.org, found[0].org));
  if (!same) return null;
  // 이 줄 이름이 기록 쪽 다른 조직에도 맞으면 애매 — 정식 이름이 같은 조직이 있으면 그쪽이 우선(matchOrgs)
  return matchOrgs(found[0].org, sections).length === 1 ? found[0] : null;
}
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
  const allSections = (model?.orgs?.sections ?? []).map(sec => ({name: sec.name, aliases: aliases.get(sec.name) ?? []}));
  for (const section of model?.orgs?.sections ?? []) {
    // ORG-별칭: 확정본 조직 줄과 기록의 조직을 정식 이름·별칭·자동 규칙(org-name-match.mjs)으로 잇는다. 줄이 둘 이상의 서로 다른 조직에 맞거나,
    // 이 조직이 서로 다른 이름의 줄 둘 이상에 맞으면 잇지 않고 '줄 고르기'(orgUnmatched)로 넘긴다. 같은 이름 줄이 여럿이면 첫 줄(전과 같음).
    const hit = matchSectionRow(section.name, aliases.get(section.name) ?? [], orgs, allSections);
    // JOURNAL-조직현황AI요약: an organization with a summary offers its summary lines (no day) instead of the raw records.
    const summary = String(section.summary?.text ?? '').split('\n').map(s => s.trim()).filter(Boolean);
    const lines = summary.length ? summary.map(text => ({day: '', text: `- ${text}`, from: section.name, summary: true}))
      : section.items.map(item => ({day: item.day, text: `- ${item.text}`, from: section.name}));
    for (const line of lines) if (hit) byOrg.get(hit.index).push(line); else orgUnmatched.push(line);
  }
  return {byRow, unmatched, byOrg, orgUnmatched};
}

// 화면에서 고친 줄 → 보고 자료. edits = {summary: Map(index → [줄]), orgs: Map(index → [줄]), sites: Map(…)}.
// 바탕(지난주 확정본의 내 칸)에 그대로 있는 줄은 검은 글씨, 그 밖의 줄(새 줄·고친 줄)은 파란 글씨. 빈 줄은 뺀다.
// 줄마다 문단 모양(paras, 확정본의 왼쪽 여백·들여쓰기 — WEEKLY-한글파일다듬기 ⑥): 바탕에 같은 글이 있으면 그 줄의 모양, 고친 줄은 같은 자리 바탕 줄의
// 모양, 새로 더한 줄은 바로 위 줄의 모양을 따른다(바탕에 모양이 없으면 칸 견본 모양).
export function assembleDraft(base, edits = {}) {
  const out = structuredClone(base);
  const mark = (row, key, after) => {
    const before = row[key] ?? [], beforeParas = row.paras ?? [];
    const kept = new Set(before.map(lineText)), used = new Set();
    const lines = [], paras = [];
    const texts = after.map(s => String(s ?? '').replace(/\s+$/, ''));
    texts.forEach((text, i) => {
      if (!text.trim()) return;
      let at = before.findIndex((l, j) => !used.has(j) && lineText(l) === text);
      if (at >= 0) used.add(at);
      const para = at >= 0 ? beforeParas[at] : (beforeParas[i] ?? (paras.length ? paras.at(-1) : beforeParas.at(-1)) ?? null);
      lines.push(kept.has(text) ? text : {text, changed: true}); paras.push(para ?? null);
    });
    row[key] = lines; row.paras = paras;
  };
  const entries = effectiveOwners(out.summary);
  for (const [index, lines] of edits.summary ?? []) { const e = entries[index]; if (e) mark(e.row, 'progress', lines); }
  for (const section of ['orgs', 'sites']) for (const [index, lines] of edits[section] ?? []) { const r = out[section]?.[index]; if (r) mark(r, 'status', lines); }
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
