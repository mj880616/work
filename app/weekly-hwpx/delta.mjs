// WEEKLY-한글초안 시제품: '직전 주 확정본'에서 이번 주 바뀐 것만 고치기.
//
// 1) personalFromTeam: 팀 최종본 요약 표에서 내 담당 줄만 남기고 나머지 진행·담당 칸은 비운 개인본 바탕(표 틀·순서·병합은 그대로).
// 2) applyPatch: AI(또는 사람)가 낸 "고칠 목록"을 바탕에 적용. 목록은 줄 단위 add/replace/remove만, 내 줄만, 바꿀 줄 원문이 정확히
//    있어야 함. 맞지 않는 항목은 적용하지 않고 rejected로 돌려준다(사람이 확인). 바뀐/더한 줄은 changed 표시(파란 글씨).
// 3) diffRows: 두 판의 내 줄을 줄 단위로 비교(같음/더함/뺌) — 비교 메모와 "지난주에 고친 문구를 또 고치지 않기" 검사에 씀.
// 4) personalReportFromTeam: 상집보고 전체 구조(W3 확대)의 개인본 바탕 — 요약 표 내 줄, 내 담당 조직 줄, 요청 표는 직전 주 그대로 + "이번 주 확인 필요".
import {lineText, isChanged} from './report.mjs';

const key = (area, row) => `${area.join('')}›${(row.task ?? []).join('')}`;
const norm = s => String(s).replace(/\s+/g, '').replace(/[‧·․]/g, '·');

// 세로로 합친 담당 칸(null)은 위 칸의 담당을 이어받는다.
export function effectiveOwners(summary) {
  const out = [];
  for (const area of summary) {
    let owner = [];
    let task = [];
    for (const row of area.rows) {
      if (row.owner !== null) owner = row.owner;
      if (row.task !== null) task = row.task;
      out.push({area: area.area, task, row, owner});
    }
  }
  return out;
}
export const isMine = (owner, me) => owner.some(line => line.split(/[\/,·]/).some(n => n.trim() === me));
// JOURNAL-주간정리다듬기 ②(2026-10-22 사용자 승인): 담당 팀원 칸의 내 이름은 직전 주 확정본에 쓴 표기를 그대로 쓴다.
// 확정본 담당 칸의 이름 조각(/ , · 로 나눈 한 사람) 가운데 내 이름(프로필)과 띄어쓰기 없이 같거나, 한쪽이 다른 쪽을 품는(예: 성 없이 쓴
// 이름, 직함을 붙인 이름) 조각이 하나뿐이면 그 표기. 없거나 여럿이면(누구인지 모름) null — 화면은 프로필 이름을 그대로 쓴다.
// 이름은 코드에 두지 않는다(공개 저장소). 여러 사람이 함께 맡은 줄의 칸 글은 바꾸지 않는다(personalFromTeam이 그대로 옮김).
export function ownerNotation(summary, name) {
  const key = s => String(s ?? '').replace(/\s+/g, '');
  const me = key(name);
  if (!me) return null;
  const tokens = new Set();
  for (const e of effectiveOwners(summary ?? [])) for (const line of e.owner ?? []) for (const n of String(line).split(/[\/,·]/)) if (n.trim()) tokens.add(n.trim());
  const exact = [...tokens].filter(t => key(t) === me);
  if (exact.length === 1) return exact[0];
  if (exact.length) return null;
  const near = [...tokens].filter(t => { const k = key(t); return Math.min(k.length, me.length) >= 2 && (k.includes(me) || me.includes(k)); });
  return near.length === 1 ? near[0] : null;
}

export function personalFromTeam(teamSummary, me) {
  const owners = new Map(effectiveOwners(teamSummary).map(e => [e.row, e.owner]));
  return teamSummary.map(area => ({
    area: [...area.area],
    rows: area.rows.map(row => {
      const mine = isMine(owners.get(row) ?? [], me);
      return {
        task: row.task === null ? null : [...row.task],
        progress: mine ? row.progress.map(lineText) : [],
        owner: row.owner === null ? null : mine ? [...row.owner] : [],
      };
    }),
  }));
}

// 상집보고 전체 구조의 개인본 바탕(다음 주 초안의 출발점).
// - 요약 표: personalFromTeam(내 줄만, 틀 그대로)
// - 1. 요청사항 표: 재료(임원 일정 배정·논의 요청 기록)가 아직 없으므로 직전 주 확정본 그대로 두고 확인 필요 표시 줄을 단다.
// - 4. 산하조직 현황: 내 담당 조직(myOrgs) 줄만, 확정본 순서대로. 글은 확정본 그대로(지난주 소식이 바탕, 바뀐 것만 고침).
// - 3. 투쟁 사업장 현황: 내 담당 조직이면 남김. 집회·농성 표, 2) 세부 내용(회의 결과 상자), 5. 주요 일정은 매주 새로 쓰므로 비움.
export const REQUEST_CHECK_NOTE = '※ 직전 주 확정본 그대로임 — 이번 주 확인 필요';
const sameName = (a, b) => norm(a) === norm(b);
export const isMyOrg = (org, myOrgs) => myOrgs.some(name => sameName(name, [].concat(org).join('')));
// 내 담당 조직 줄만 남김. 확정본 줄 테두리(borders)를 따라가고, 바로 위 줄이 빠진 줄은 cutAbove(위 선 닫기, report.mjs pairGrid).
function keepOrgRows(rows, myOrgs) {
  const kept = (rows ?? []).filter(r => isMyOrg(r.org, myOrgs));
  return kept.map((r, i) => ({org: [...r.org], status: r.status.map(lineText), ...(r.borders ? {borders: [...r.borders]} : {}),
    ...(Number.isInteger(r.src) ? {src: r.src, cutAbove: i === 0 ? r.src !== 0 : kept[i - 1].src !== r.src - 1} : {})}));
}
export function personalReportFromTeam(team, me, {myOrgs = [], title = '', date = ''} = {}) {
  return {
    title, date,
    requests: structuredClone(team.requests ?? []),
    requestNote: (team.requests ?? []).length ? REQUEST_CHECK_NOTE : undefined,
    schedule: [],
    summary: personalFromTeam(team.summary ?? [], me),
    details: [],
    rallies: [],
    sites: keepOrgRows(team.sites, myOrgs),
    orgs: keepOrgRows(team.orgs, myOrgs),
    orgNotes: [],
    calendar: [],
    calendarNotes: [],
  };
}

// 조직 줄 고치기: {section:'orgs'|'sites', org:'조직 A'} — 내 담당 조직 줄만.
function applyOrgItem(report, item, myOrgs) {
  const list = report[item.at.section];
  const row = (list ?? []).find(r => sameName(r.org.join(''), item.at.org ?? ''));
  if (!row) return '그런 조직 줄이 없음';
  if (!isMyOrg(row.org, myOrgs)) return '내 담당 조직이 아님';
  return applyLineOp(row.status, item);
}
function applyLineOp(lines, item) {
  const index = item.old === undefined ? -1 : lines.findIndex(l => lineText(l) === item.old);
  if (item.op === 'add') {
    if (typeof item.text !== 'string' || !item.text.trim()) return '더할 글이 비어 있음';
    const after = item.after === undefined ? lines.length - 1 : lines.findIndex(l => lineText(l) === item.after);
    if (item.after !== undefined && after < 0) return '뒤에 붙일 줄을 찾지 못함';
    lines.splice(after + 1, 0, {text: item.text, changed: true});
  } else if (item.op === 'replace') {
    if (index < 0) return '바꿀 줄 원문이 바탕에 없음';
    if (isChanged(lines[index])) return '이번 주에 이미 고친 줄';
    lines[index] = {text: item.text, changed: true};
  } else if (item.op === 'remove') {
    if (index < 0) return '뺄 줄 원문이 바탕에 없음';
    lines.splice(index, 1);
  } else return '알 수 없는 op';
  return null;
}

// 전체 구조 고칠 목록. 요약 표 항목은 applyPatch와 같고, 아래가 더해진다.
//   {op, at:{section:'orgs'|'sites', org}, old?, text?, after?}  — 내 담당 조직 줄
//   {op:'add', at:{section:'calendar'}, day, what, who:[]}        — 이번 주 일정(새로 쓰는 표)
//   {op:'add', at:{section:'details'}, heading, box:[{label, lines}]} — 회의 결과 상자
//   {op:'add', at:{section:'rallies'}, when:[], name:[], attend:[]}
// 요청 표는 사람이 정하는 칸(참석 요청 대상)이라 고칠 목록으로 바꾸지 않는다.
export function applyReportPatch(report, patch, me, {myOrgs = []} = {}) {
  const out = structuredClone(report);
  const summaryItems = [];
  const applied = [];
  const rejected = [];
  for (const item of patch) {
    const section = item.at?.section ?? 'summary';
    if (section === 'summary') { summaryItems.push(item); continue; }
    let reason = null;
    if (section === 'orgs' || section === 'sites') reason = applyOrgItem(out, item, myOrgs);
    else if (item.op !== 'add') reason = '이 칸은 더하기만 받음';
    else if (section === 'calendar') {
      if (!item.day || !item.what) reason = '날짜·내용이 비어 있음';
      else {
        const day = out.calendar.find(d => d.day === item.day) ?? (out.calendar.push({day: item.day, items: []}), out.calendar[out.calendar.length - 1]);
        day.items.push({what: {text: item.what, changed: true}, who: (item.who ?? []).map(text => ({text, changed: true}))});
      }
    } else if (section === 'details') {
      if (!item.heading || !(item.box ?? []).length) reason = '제목·상자가 비어 있음';
      else out.details.push({heading: item.heading, box: item.box.map(b => ({label: b.label, lines: (b.lines ?? []).map(text => ({text, changed: true}))}))});
    } else if (section === 'rallies') {
      out.rallies.push({when: item.when ?? [], name: item.name ?? [], attend: item.attend ?? []});
    } else reason = '알 수 없는 칸';
    if (reason) rejected.push({item, reason}); else applied.push(item);
  }
  const s = applyPatch(out.summary, summaryItems, me);
  out.summary = s.summary;
  return {report: out, applied: [...applied, ...s.applied], rejected: [...rejected, ...s.rejected]};
}

// 줄 위치: {area:'사업영역 A', task:'세부 과제 A-1', nth?:0} — 같은 세부 과제가 여러 줄(세로 병합)이면 nth로 고른다.
function locate(summary, at) {
  const hits = effectiveOwners(summary).filter(e => norm(e.area.join('')) === norm(at.area) && norm(e.task.join('')) === norm(at.task));
  return hits[at.nth ?? 0];
}

// patch: [{op:'add', at, text, after?}, {op:'replace', at, old, text}, {op:'remove', at, old}]
export function applyPatch(summary, patch, me) {
  const out = structuredClone(summary);
  const applied = [];
  const rejected = [];
  for (const item of patch) {
    const hit = locate(out, item.at ?? {});
    if (!hit) { rejected.push({item, reason: '그런 사업영역·세부 과제 줄이 없음'}); continue; }
    if (!isMine(hit.owner, me)) { rejected.push({item, reason: '내 담당 줄이 아님'}); continue; }
    const lines = hit.row.progress;
    const index = item.old === undefined ? -1 : lines.findIndex(l => lineText(l) === item.old);
    if (item.op === 'add') {
      if (typeof item.text !== 'string' || !item.text.trim()) { rejected.push({item, reason: '더할 글이 비어 있음'}); continue; }
      const after = item.after === undefined ? lines.length - 1 : lines.findIndex(l => lineText(l) === item.after);
      if (item.after !== undefined && after < 0) { rejected.push({item, reason: '뒤에 붙일 줄을 찾지 못함'}); continue; }
      lines.splice(after + 1, 0, {text: item.text, changed: true});
    } else if (item.op === 'replace') {
      if (index < 0) { rejected.push({item, reason: '바꿀 줄 원문이 바탕에 없음'}); continue; }
      if (isChanged(lines[index])) { rejected.push({item, reason: '이번 주에 이미 고친 줄'}); continue; }
      lines[index] = {text: item.text, changed: true};
    } else if (item.op === 'remove') {
      if (index < 0) { rejected.push({item, reason: '뺄 줄 원문이 바탕에 없음'}); continue; }
      lines.splice(index, 1);
    } else { rejected.push({item, reason: '알 수 없는 op'}); continue; }
    applied.push(item);
  }
  return {summary: out, applied, rejected};
}

// 줄 단위 LCS 비교 → [{op:'same'|'add'|'remove', text}]
export function diffLines(a, b) {
  const A = a.map(lineText), B = b.map(lineText);
  const L = Array.from({length: A.length + 1}, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({op: 'same', text: A[i]}); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({op: 'remove', text: A[i++]});
    else out.push({op: 'add', text: B[j++]});
  }
  while (i < A.length) out.push({op: 'remove', text: A[i++]});
  while (j < B.length) out.push({op: 'add', text: B[j++]});
  return out;
}

export const rowKeyOf = e => norm(e.area.join('') + '›' + e.task.join(''));
const common = (a, b) => diffLines(a, b).filter(l => l.op === 'same').length;
// 두 판의 줄 짝짓기: 사업영역·세부 과제가 같은 줄끼리, 같은 줄(문장)이 많은 짝부터. 한 세부 과제에 줄이 여럿이어도(세로 병합)
// 순서가 아니라 내용으로 짝을 찾는다. 겹치는 문장이 없으면 남은 것끼리 순서대로. → Map(N 번호 → P 번호)
export function matchRows(P, N) {
  const pairs = [];
  N.forEach((n, j) => P.forEach((p, i) => { if (rowKeyOf(p) === rowKeyOf(n)) pairs.push([common(p.row.progress, n.row.progress), i, j]); }));
  pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const usedP = new Set(), out = new Map();
  for (const [, i, j] of pairs) if (!usedP.has(i) && !out.has(j)) { usedP.add(i); out.set(j, i); }
  return out;
}

// 두 판의 내 줄 비교: 세부 과제 이름은 띄어쓰기·가운뎃점 차이를 무시하고 맞춘다.
export function diffRows(prev, next, me) {
  const mine = s => effectiveOwners(s).filter(e => isMine(e.owner, me));
  const P = mine(prev), N = mine(next);
  const match = matchRows(P, N);
  const rows = N.map((n, j) => {
    const p = match.has(j) ? P[match.get(j)] : null;
    return {area: n.area, task: n.task, status: p ? 'kept' : 'added', lines: diffLines(p ? p.row.progress : [], n.row.progress)};
  });
  const used = new Set(match.values());
  P.forEach((p, i) => { if (!used.has(i)) rows.push({area: p.area, task: p.task, status: 'removed', lines: diffLines(p.row.progress, [])}); });
  return rows;
}
export {key as rowKey};
