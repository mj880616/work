// collector-feed ?action=context: 통화 분석 스크립트가 '통화 요약용 맥락' 문서의 자동 구간을 고치려고 읽어 가는 이름 목록.
// (CALL-맥락문서, docs/design/call-context.md 3.1·3.2절) 읽기 전용. 이름 문자열만 만든다: ID·날짜·상태·메모·담당자·연락처는 응답에 넣지 않는다.
// 사람 이름·직함(CALL-맥락사람): 표를 직접 읽지 않고 읽기 전용 DB 함수 app_call_context_people(service_role 실행)가 돌려준 네 칸
// (조직 정식 이름·약칭, 상대 글, 고친 값 표시)만 받아 "조직 — 이름 직함" 쌍으로 다듬는다. 번호·메모·통화 내용·ID는 함수가 내보내지 않는다.
import { projectOptions } from "../ai-assist/library-fill.ts";
import { cleanLine, hasPhone, type OrgRow } from "./call-analysis.ts";

export const CONTEXT_LIMITS = Object.freeze({
  organizations: 150, organizationChars: 60, aliases: 5, aliasChars: 30,
  projects: 80, projectChars: 100,
  // 응답 합계(이름·약칭 글자 수). 넘으면 앞에서부터 담고 나머지는 omitted로 센다.
  totalChars: 6000,
  // 사람 목록(조직 — 이름 직함)은 따로 센다: 개수·글자 수(조직+사람 글자 합계).
  people: 150, personOrgChars: 60, personChars: 60, peopleTotalChars: 6000,
  // 하루 호출 상한(인스턴스별 최선 노력. DB 표를 늘리지 않으려고 메모리로만 센다).
  dailyCalls: 20,
});

export const CONTEXT_PEOPLE_FN = "app_call_context_people";
export const CONTEXT_PEOPLE_ROWS = 300;

export type ContextOrg = { name: string; aliases: string[] };
// organization이 null이면 조직 없이 이름·직함만(우리 쪽 사람, 조직을 모르는 사람은 목록에 넣지 않는다).
export type ContextPerson = { organization: string | null; person: string };
export type ContextResult = {
  organizations: ContextOrg[]; projects: string[]; people: ContextPerson[]; omitted: { organizations: number; projects: number; people: number };
};

// 우리 쪽(상대 표에서 조직 없이 이름·직함만 보이는 곳). app/feed-model.mjs OWN_ORG와 같은 값(Edge는 app/을 가져올 수 없어 복사해 둔다).
export const OWN_ORG = "공공운수노조";
const ORG_WORD = /(노동조합|노조|지부|지회|분회|본부|연맹|협의회|공사|공단)$/;
const NO_PERSON = /^(없음|해당\s*없음|미상|불명|확인\s*불가|확인\s*필요|상대방?|상대방?\s*[(（]?\s*화자\s*\d{0,2}\s*[)）]?|화자\s*\d{0,2})$/;
const commonPrefix = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

const chars = (s: string) => [...s];
// 자동 구간 표시(<<…>>)와 마크다운이 이름 안에서 문서 구조를 흉내 내지 못하게 한다.
function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return cleanLine(value.replace(/[<>\[\]]/g, " "), max);
}

export function buildContext(orgRows: OrgRow[], spaceRows: unknown, peopleRows: unknown = []): ContextResult {
  const L = CONTEXT_LIMITS;
  let used = 0;
  const fits = (n: number) => (used + n <= L.totalChars ? (used += n, true) : false);

  // 담당조직: 쓰지 않음(active=false) 제외(ai-assist organizationOptions와 같은 기준이되 80개 제한 없이 이 파일의 상한만 따른다). 약칭은 정식 이름과 다른 것만.
  const organizations: ContextOrg[] = [];
  let orgOmitted = 0;
  const seenOrg = new Set<string>();
  for (const r of orgRows) {
    if (r.active === false) continue;
    const name = clean(r.name, L.organizationChars);
    if (!name || seenOrg.has(name)) continue;
    seenOrg.add(name);
    const aliases: string[] = [];
    for (const a of r.aliases ?? []) {
      const alias = clean(a, L.aliasChars);
      if (alias && alias !== name && !aliases.includes(alias) && aliases.length < L.aliases) aliases.push(alias);
    }
    const size = chars(name).length + aliases.reduce((n, a) => n + chars(a).length, 0);
    if (organizations.length >= L.organizations || !fits(size)) { orgOmitted++; continue; }
    organizations.push({ name, aliases });
  }

  // 프로젝트: 진행 중(보관 제외), projectOptions와 같은 포함 기준. 이름은 상위 한 단계까지 '상위 › 하위'.
  const rows = (Array.isArray(spaceRows) ? spaceRows : []).filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  const byId = new Map(rows.map((r) => [String(r.id).toLowerCase(), r]));
  const projects: string[] = [];
  let projectOmitted = 0;
  const seenProject = new Set<string>();
  for (const opt of projectOptions(rows)) {
    const row = byId.get(opt.id);
    if (!row) continue;
    const leaf = clean(row.name, L.projectChars);
    const parent = typeof row.parent_id === "string" ? byId.get(row.parent_id.toLowerCase()) : undefined;
    const up = parent ? clean(parent.name, L.projectChars) : null;
    const label = [up, leaf].filter(Boolean).join(" › ");
    const text = label ? chars(label).slice(0, L.projectChars).join("") : null;
    if (!text || seenProject.has(text)) continue;
    seenProject.add(text);
    if (projects.length >= L.projects || !fits(chars(text).length)) { projectOmitted++; continue; }
    projects.push(text);
  }
  const { people, omitted: peopleOmitted } = buildPeople(peopleRows);
  return { organizations, projects, people, omitted: { organizations: orgOmitted, projects: projectOmitted, people: peopleOmitted } };
}

type Candidate = { org: string | null; own: boolean; person: string; name: string; edited: boolean };

// 읽기 함수가 준 순서(고친 값 먼저, 그다음 최근 통화)를 그대로 우선순위로 쓴다.
// - 상대 글 '조직 이름 직함'에서 조직 앞부분을 뗀다(연결 조직 이름·약칭, 아니면 첫 낱말이 …노조·…지부 꼴일 때). 우리 쪽(OWN_ORG)이면 조직 없이 이름·직함만.
// - 전화번호·이메일 꼴, 이름표 없는 화자 번호, 빈 값은 버린다.
// - 같은 조직·같은 이름은 한 줄. 같은 이름에 조직이 둘 이상이면, 가장 앞선 것이 고친 값이고 나머지는 고친 값이 아닐 때만 그 하나를 남기고 아니면 모두 뺀다.
//   조직을 모르는 줄(우리 쪽도 아님)은 누구 소속인지 알 수 없어 넣지 않는다.
export function buildPeople(rows: unknown): { people: ContextPerson[]; omitted: number } {
  const L = CONTEXT_LIMITS;
  const cands: Candidate[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const cp = clean(row.counterpart, 100);
    if (!cp || hasPhone(cp) || cp.includes("@")) continue;
    const full = clean(row.organization_name, L.personOrgChars) ?? "";
    const aliases = (Array.isArray(row.organization_aliases) ? row.organization_aliases : [])
      .map((a) => clean(a, L.aliasChars)).filter((a): a is string => !!a).sort((a, b) => b.length - a.length);
    let person = cp, cpOrg = "";
    const prefixes = [full, ...aliases].filter(Boolean);
    const hit = prefixes.find((o) => cp === o || cp.startsWith(`${o} `));
    if (hit) { person = cp.slice(hit.length).trim(); cpOrg = hit; }
    else {
      const w = cp.split(" ");
      if (w.length >= 2 && ORG_WORD.test(w[0])) { person = w.slice(1).join(" ").trim(); cpOrg = w[0]; }
    }
    const related = !!full && !!cpOrg && (cpOrg === full || aliases.includes(cpOrg) || commonPrefix(cpOrg, full) >= 4);
    const org = cpOrg ? (related ? full : cpOrg) : full;
    person = chars(person).slice(0, L.personChars).join("").trim();
    if (!person || NO_PERSON.test(person) || hasPhone(person) || /화자\s*\d/.test(person)) continue;
    const own = !!org && org.startsWith(OWN_ORG);
    if (!org) continue;
    const name = person.split(" ")[0].toLowerCase();
    if (chars(name).length < 2) continue;
    cands.push({ org: own ? null : org, own, person, name, edited: row.user_edited === true });
  }
  // 같은 조직·이름은 앞선 것만.
  const seen = new Set<string>();
  const uniq = cands.filter((c) => { const k = `${c.org ?? (c.own ? "\u0001" : "")}\u0000${c.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
  // 같은 이름에 조직이 둘 이상.
  const byName = new Map<string, Candidate[]>();
  for (const c of uniq) byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  const keep = new Set<Candidate>();
  for (const group of byName.values()) {
    const orged = group.filter((c) => c.org);
    group.filter((c) => c.own).forEach((c) => keep.add(c));
    if (orged.length === 1) keep.add(orged[0]);
    else if (orged.length > 1 && orged[0].edited && !orged.slice(1).some((c) => c.edited)) keep.add(orged[0]);
  }
  const people: ContextPerson[] = [];
  let used = 0, omitted = 0;
  for (const c of uniq) {
    if (!keep.has(c)) continue;
    const size = chars(c.org ?? "").length + chars(c.person).length;
    if (people.length >= L.people || used + size > L.peopleTotalChars) { omitted++; continue; }
    used += size;
    people.push({ organization: c.org, person: c.person });
  }
  return { people, omitted };
}
