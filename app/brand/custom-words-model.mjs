// APP-기록+이름바꾸기(S67-44, docs/design/girok-custom-words.md): 사람마다 메뉴·분류 이름을 고쳐 쓰는 설정의 뜻을 정하는 유일한 곳.
// DOM·네트워크·기기 저장소 없음(단위 시험 대상). 값은 내 프로필 행 app_profiles.custom_words(서버, owner RLS)에만 있다.
//
// 단어 값의 출처(위가 이긴다):
//   1. 내가 고친 이름(custom_words, 칸 id → 글자)
//   2. 빌드 얼굴의 기본값(app/brand/faces.mjs → 기록+는 girok-words.mjs, 노동조합+는 글자 그대로)
// 고칠 수 있는 칸은 아래 SLOTS뿐이다(문장 전체 고치기 아님). 칸 id 목록과 글자 규칙은 DB 검사(app_profiles_custom_words_check)와 같아야 한다.
import {wordIn} from './faces.mjs';

// keys: 이 칸이 맡는 노조 글자(단어표 열쇠). '#자리' 열쇠는 그 자리에만, 나머지는 문장 안에서도 바뀐다.
// kind: true면 활동 분류 칸(word(글자,'kind') 자리에만 — 문장 안 '회의'·'교육' 같은 낱말은 건드리지 않는다).
// hint: 화면에서 이 칸이 무엇인지 보여 주는 작은 글자(노조 색 없음).
export const SLOTS = Object.freeze([
  {id: 'menu_biz', hint: '메뉴', keys: ['사업 관리', '사업 관리#title']},
  {id: 'report', hint: '기록 한 건', keys: ['사업 보고', '사업보고']},
  {id: 'area', hint: '큰 묶음', keys: ['사업영역', '사업 영역']},
  {id: 'menu_org', hint: '메뉴', keys: ['조직 관리', '조직 관리#title']},
  {id: 'org_one', hint: '대상 한 곳', keys: ['담당조직', '담당 조직']},
  {id: 'org_report', hint: '대상 기록', keys: ['조직 보고', '조직보고']},
  {id: 'workplace', hint: '중요 대상', keys: ['투쟁사업장', '투쟁 사업장']},
  {id: 'kind_meeting', hint: '분류', keys: ['회의#kind'], kind: true},
  {id: 'kind_policy', hint: '분류', keys: ['정책#kind'], kind: true},
  {id: 'kind_negotiation', hint: '분류', keys: ['교섭#kind'], kind: true},
  {id: 'kind_press', hint: '분류', keys: ['언론#kind'], kind: true},
  {id: 'kind_assembly', hint: '분류', keys: ['국회#kind'], kind: true},
  {id: 'kind_struggle', hint: '분류', keys: ['투쟁#kind'], kind: true},
  {id: 'kind_education', hint: '분류', keys: ['교육#kind'], kind: true},
  {id: 'kind_other', hint: '분류', keys: ['기타#kind'], kind: true}
].map(slot => Object.freeze({...slot, keys: Object.freeze([...slot.keys])})));
export const SLOT_IDS = Object.freeze(SLOTS.map(slot => slot.id));
export const NAME_MAX = 20;
export const TOTAL_MAX_BYTES = 2000;

const split = key => { const at = key.indexOf('#'); return at < 0 ? [key, undefined] : [key.slice(0, at), key.slice(at + 1)]; };
/** 얼굴 기본값으로 이 열쇠가 어떻게 보이나(내가 고친 이름을 빼고). */
const faceText = (face, key) => { const [text, slot] = split(key); return wordIn(face, text, slot); };
/** 칸의 기본 이름(얼굴 기본값). 화면의 '기본 이름' 글자. */
export const defaultName = (face, slot) => faceText(face, slot.keys[0]);

/** 이름 하나의 모양 검사(DB 검사와 같게): 1~20자, 앞뒤 공백·제어문자 없음, < > & " ' ` \ 없음. 맞으면 다듬은 글자, 아니면 ''. */
export function cleanName(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || [...text].length > NAME_MAX) return '';
  if (/[\p{Cc}<>&"'`\\]/u.test(text)) return '';
  return text;
}

/** 서버 값 → {칸 id: 이름}. 모르는 칸·모양이 틀린 값은 버린다(화면이 깨지지 않게). */
export function parseCustomWords(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return Object.freeze({});
  const out = {};
  for (const id of SLOT_IDS) {
    if (!Object.hasOwn(raw, id)) continue;
    const name = cleanName(raw[id]);
    if (name && name === raw[id]) out[id] = name;
  }
  return Object.freeze(out);
}

/**
 * 화면 입력 {칸 id: 입력 글자} → 저장할 값. 빈칸·기본 이름과 같은 칸은 담지 않는다(기본으로 되돌림).
 * 담을 칸이 없으면 null(= 아무것도 고치지 않음). 틀린 입력이 있으면 {error: 칸 id}.
 */
export function buildSaveValue(face, inputs) {
  const out = {};
  for (const slot of SLOTS) {
    const raw = typeof inputs?.[slot.id] === 'string' ? inputs[slot.id].trim() : '';
    if (!raw) continue;
    const name = cleanName(raw);
    if (!name) return {error: slot.id};
    if (name === defaultName(face, slot)) continue;
    out[slot.id] = name;
  }
  if (!Object.keys(out).length) return {value: null};
  if (new TextEncoder().encode(JSON.stringify(out)).length > TOTAL_MAX_BYTES) return {error: 'size'};
  return {value: out};
}

/**
 * 얼굴 + 내가 고친 이름 → 화면이 쓰는 얼굴(단어표만 다름). 고친 칸이 없으면 얼굴 그대로.
 * 고친 칸의 열쇠는 내 이름으로 바꾸고, 그 열쇠를 품은 얼굴의 문장 열쇠는 뺀다 — 그 문장은 낱말 바꾸기로 다시 맞춰져
 * 문장 안에서도 내 이름이 보인다(조사는 faces.mjs가 새 말에 맞춘다). 분류 칸은 '#kind' 자리에만 쓴다.
 */
export function applyCustomWords(face, custom) {
  // 칸의 첫 열쇠(대표 글자)가 얼굴 기본값과 같으면 그 칸은 바꾸지 않는다(붙여 쓴 꼴 같은 딸린 열쇠도 그대로 — 고친 이름이 기본과 같으면 화면 한 글자도 안 바뀜).
  const changed = SLOTS.filter(slot => Object.hasOwn(custom || {}, slot.id) && defaultName(face, slot) !== custom[slot.id]);
  if (!changed.length) return face;
  const words = {...face.words};
  const mine = {};
  for (const slot of changed) for (const key of slot.keys) mine[key] = custom[slot.id];
  const inText = Object.keys(mine).filter(key => !key.includes('#'));
  for (const key of Object.keys(words)) {
    if (Object.hasOwn(mine, key)) continue;
    const [text] = split(key);
    if (inText.some(part => text !== part && text.includes(part))) delete words[key];
  }
  Object.assign(words, mine);
  return Object.freeze({...face, words: Object.freeze(words)});
}
