// APP-기록+이름바꾸기(S67-44, docs/design/girok-custom-words.md): 사람마다 메뉴·분류 이름을 고쳐 쓰는 설정의 뜻을 정하는 유일한 곳.
// DOM·네트워크·기기 저장소 없음(단위 시험 대상). 값은 내 프로필 행 app_profiles.custom_words(서버, owner RLS)에만 있다.
//
// 단어 값의 출처(위가 이긴다):
//   1. 내가 고친 이름(custom_words, 칸 id → 글자)
//   2. 빌드 얼굴의 기본값(app/brand/faces.mjs → 기록+는 girok-words.mjs, 노동조합+는 글자 그대로)
// 고칠 수 있는 칸은 아래 SLOTS뿐이다(문장 전체 고치기 아님). 칸 id 목록과 글자 규칙은 DB 검사(app_profiles_custom_words_check)와 같아야 한다.
import {FACES, wordIn} from './faces.mjs';

// S67-62 바탕 낱말 묶음: 사람마다 얼굴 단어표 대신 다른 얼굴의 단어표 하나를 바탕으로 쓴다(그 위에 고친 이름 15칸).
// 고르는 길은 서버 운영자 허용 표(public.app_operator_features, SQL로만 넣음, 화면·API로 못 씀)뿐이고, 화면은 app_my_features 답으로 읽는다.
// 화면에서 고르는 메뉴는 없다(미리 만든 묶음을 다른 사람에게 보이지 않는다, 2026-11-20 결정). 기능 키 → 얼굴 id.
export const WORD_BASE_FEATURES = Object.freeze({nojo_words: 'nojo'});

// keys: 이 칸이 맡는 노조 글자(단어표 열쇠). '#자리' 열쇠는 그 자리에만, 나머지는 문장 안에서도 바뀐다.
// kind: true면 활동 분류 칸(word(글자,'kind') 자리에만 — 문장 안 '회의'·'교육' 같은 낱말은 건드리지 않는다).
// hint: 화면에서 이 칸이 무엇인지 보여 주는 작은 글자(노조 색 없음).
// menu: 이 칸이 이름을 맡는 메뉴 항목 id(app/menu-model.mjs ITEMS). '메뉴 수정' 창이 그 줄에서 이름을 바로 바꾼다(S67-71, 같은 칸·같은 저장).
//   (NAV-조직사업합침 2026-11-28부터 menu가 있는 칸은 없다 — 이름을 고치던 두 메뉴가 [조직·사업] 하나로 합쳐졌다.)
// tab: [조직·사업] 큰 탭 이름 칸(org-biz-tabs.mjs). 메뉴 수정 창 '다른 이름'에서 고친다.
export const SLOTS = Object.freeze([
  // NAV-조직사업합침(2026-11-28): menu_biz·menu_org는 [조직·사업] 메뉴 안 큰 탭 [사업 관리]·[조직 관리]의 이름 칸이다(메뉴 줄 이름이 아님 → menu 없음,
  // 메뉴 수정 창의 '다른 이름'에서 고친다). 첫 열쇠 '#tab'이 기본 이름이라 WORK ON+ 기본에서도 '조직 관리'·'사업 관리'(girok-words.mjs).
  // 칸 id는 그대로라(DB 검사 같음) 옛 메뉴 이름을 고쳐 둔 사람은 그 이름이 큰 탭 이름으로 이어진다.
  {id: 'menu_biz', hint: '큰 탭', tab: true, keys: ['사업 관리#tab', '사업 관리', '사업 관리#title']},
  {id: 'report', hint: '기록 한 건', keys: ['사업 보고', '사업보고']},
  {id: 'area', hint: '큰 묶음', keys: ['사업영역', '사업 영역']},
  {id: 'menu_org', hint: '큰 탭', tab: true, keys: ['조직 관리#tab', '조직 관리', '조직 관리#title']},
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
/** 메뉴 항목 id → 그 메뉴 이름을 맡는 칸(없으면 null = 이름을 바꿀 수 없는 메뉴). */
export const slotOfMenu = id => SLOTS.find(slot => slot.menu && slot.menu === id) || null;
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
  // NAV-조직사업합침: 큰 탭 칸(tab)은 열쇠마다 얼굴 글자가 다를 수 있다(큰 탭 '조직 관리' / 화면 글자 '거래처·직원'). 그 칸은 한 열쇠라도
  // 고친 이름과 다르면 바꾼다 — 옛 기본(거래처·직원)일 때 '조직 관리'로 고쳐 둔 사람의 화면 글자가 새 기본과 같아졌다고 되돌아가지 않게. 다른 칸은 그대로.
  const differs = slot => slot.tab ? slot.keys.some(key => faceText(face, key) !== custom[slot.id]) : defaultName(face, slot) !== custom[slot.id];
  const changed = SLOTS.filter(slot => Object.hasOwn(custom || {}, slot.id) && differs(slot));
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

/** 서버 기능 목록(app_my_features 답) → 바탕 낱말 묶음 얼굴 id. 없거나 목록이 아니면 null(= 빌드 얼굴 단어 그대로). */
export function wordBaseOf(features) {
  if (!Array.isArray(features)) return null;
  for (const [feature, base] of Object.entries(WORD_BASE_FEATURES)) if (features.includes(feature)) return base;
  return null;
}

/** 빌드 얼굴 + 바탕 낱말 묶음 → 단어표만 그 묶음 것으로 바꾼 얼굴(이름·아이콘·메뉴는 빌드 얼굴 그대로). 묶음이 없거나 같으면 얼굴 그대로. */
export function withWordBase(face, base) {
  if (!base || !Object.hasOwn(FACES, base) || FACES[base].words === face.words) return face;
  return Object.freeze({...face, words: FACES[base].words});
}
