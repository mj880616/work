// collector-feed ?action=context: 통화 분석 스크립트가 '통화 요약용 맥락' 문서의 자동 구간을 고치려고 읽어 가는 이름 목록.
// (CALL-맥락문서, docs/design/call-context.md 3.1·3.2절) 읽기 전용. 이름 문자열만 만든다: ID·날짜·상태·메모·담당자·연락처는 응답에 넣지 않는다.
// 사람 이름·직함은 아직 Web2 표에 업무 상대 목록이 없고, 통화함 상대 표기(app_feed_items.counterpart)는 서비스 키 읽기 grant 밖이라 이번에는 넣지 않는다.
import { projectOptions } from "../ai-assist/library-fill.ts";
import { cleanLine, type OrgRow } from "./call-analysis.ts";

export const CONTEXT_LIMITS = Object.freeze({
  organizations: 150, organizationChars: 60, aliases: 5, aliasChars: 30,
  projects: 80, projectChars: 100,
  // 응답 합계(이름·약칭 글자 수). 넘으면 앞에서부터 담고 나머지는 omitted로 센다.
  totalChars: 6000,
  // 하루 호출 상한(인스턴스별 최선 노력. DB 표를 늘리지 않으려고 메모리로만 센다).
  dailyCalls: 20,
});

export type ContextOrg = { name: string; aliases: string[] };
export type ContextResult = {
  organizations: ContextOrg[]; projects: string[]; omitted: { organizations: number; projects: number };
};

const chars = (s: string) => [...s];
// 자동 구간 표시(<<…>>)와 마크다운이 이름 안에서 문서 구조를 흉내 내지 못하게 한다.
function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return cleanLine(value.replace(/[<>\[\]]/g, " "), max);
}

export function buildContext(orgRows: OrgRow[], spaceRows: unknown): ContextResult {
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
  return { organizations, projects, omitted: { organizations: orgOmitted, projects: projectOmitted } };
}
