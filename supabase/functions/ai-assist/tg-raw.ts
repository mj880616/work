// 텔레그램 소식 원문 줄을 AI 재료로 다듬는 공용 순수 함수(명진 결정 변경 10/29 07:29~07:30: 텔레그램 원문·보낸 사람 이름도 AI 재료).
// Web2에 물어보기(ask_web2)와 교섭·회의 전 한 장(pre_meeting_sheet)이 같이 쓴다. 입출력(표 읽기)은 handler.ts.
// - 원문(app_feed_items.raw_text, 업무 텔레그램만)은 collector-feed가 "HH:MM 라벨[ (전달)]: 말" 줄로 남긴다(라벨 A·B…).
// - 라벨 → 표시 이름은 collector-feed(TG-발언자이름 결정 3)와 같은 순서: 명진이 붙인 이름 → 본인 표시면 "나" → 라벨 그대로.
//   자동 이름·열쇠·사람 id는 쓰지 않는다. 개인 텔레그램 표는 이 모듈과 무관하다(읽지 않음).
// - 연락처 가리기는 부르는 쪽이 넘긴다(물어보기는 evidence.ts, 한 장은 sheet-evidence.ts). 줄마다 가린 뒤 " / "로 이어 상한에서 자른다.
//   (자른 뒤에 가리면 잘린 번호가 남을 수 있어서 먼저 가린다.) 이 파일은 두 쓰임이 같은 내용으로 둔다(import 없음).

export const TG_RAW_CHARS = 600;
export const TG_RAW_MAX_ITEMS = 8;
export const TG_NAME_CHARS = 40;

const LABEL = /^[A-Z]{1,3}$/;
const LINE = /^(\d{2}:\d{2}) ([A-Z]{1,3})( \(전달\))?: ?(.*)$/;
const cleanName = (v: unknown) =>
  typeof v === "string" ? [...v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().normalize("NFC")].slice(0, TG_NAME_CHARS).join("") : "";

// day_senders 줄({room_key, day, label, sender_id})과 senders 줄({id, name, is_self})로 "방|날짜" → (라벨 → 표시 이름).
export function tgNameMaps(daySenders: unknown, senders: unknown): Map<string, Map<string, string>> {
  const people = new Map<string, { name: string; self: boolean }>();
  if (Array.isArray(senders)) {
    for (const s of senders as Record<string, unknown>[]) {
      if (typeof s?.id !== "string") continue;
      people.set(s.id.toLowerCase(), { name: cleanName(s.name), self: s.is_self === true });
    }
  }
  const out = new Map<string, Map<string, string>>();
  if (!Array.isArray(daySenders)) return out;
  for (const r of daySenders as Record<string, unknown>[]) {
    const label = typeof r?.label === "string" ? r.label : "";
    if (!LABEL.test(label) || typeof r.room_key !== "string" || typeof r.day !== "string" || typeof r.sender_id !== "string") continue;
    const p = people.get(r.sender_id.toLowerCase());
    const name = p?.name || (p?.self ? "나" : "");
    if (!name) continue;
    const key = r.room_key + "|" + r.day.slice(0, 10);
    if (!out.has(key)) out.set(key, new Map());
    out.get(key)!.set(label, name);
  }
  return out;
}

// 원문 → AI 재료 한 줄. 라벨을 표시 이름으로 바꾸고(같은 이름이 둘 이상이면 뒤에 (라벨)), 줄마다 mask(연락처 가림)를 거쳐 max자에서 자른다.
export function tgRawForAi(raw: unknown, names: ReadonlyMap<string, string>, mask: (s: string) => string, max = TG_RAW_CHARS): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const count = new Map<string, number>();
  for (const n of names.values()) count.set(n, (count.get(n) ?? 0) + 1);
  const who = (label: string) => {
    const n = names.get(label);
    return n ? ((count.get(n) ?? 0) > 1 ? `${n}(${label})` : n) : label;
  };
  const parts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = LINE.exec(line);
    const text = m ? `${m[1]} ${who(m[2])}${m[3] ?? ""}: ${m[4]}` : line;
    const s = mask(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
    if (s) parts.push(s);
  }
  const all = [...parts.join(" / ")];
  return all.length > max ? all.slice(0, max).join("") + "…" : all.join("");
}
