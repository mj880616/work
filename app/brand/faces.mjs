// APP-올인원다이어리 단계 2(docs/design/allinone-diary-plan.md): 같은 코드에 얼굴 둘. 얼굴마다 다른 것은 이 파일 한 곳에만 둔다.
// DOM·네트워크·기기 저장소 없음. 어떤 얼굴인지는 빌드가 정한다(app/brand/face.mjs 한 줄, scripts/brand-face.mjs가 고쳐 씀).
// 실행 중 사용자 조작·주소·로컬 저장으로 바뀌지 않는다.
//
// 앱 이름은 WORK ON+(2026-11-21 07:35 사용자 확정, 그 전 WORK ON 11-20 22:22, 옛 가칭 기록+), 아이콘은 표장 A 'W를 품은 원'에 + 를 단 판
// (11-21 07:35 확정, + 가운데가 원 테두리 위, app/app-icon.svg,
// scripts/app-icon/build-app-icons.py). 앱 이름·아이콘은 사람별 이름 바꾸기 대상이 아니다(app/brand/custom-words-model.mjs 칸 밖).
// nojo  = 지금 운영 빌드(이름 WORK ON+, 지금 화면 단어 그대로). 단어표가 비어 있어 모든 글자가 지금 그대로다(tests/brand-faces.test.mjs).
//         얼굴 id 'nojo'는 빌드·시험이 부르는 이름이라 그대로 둔다.
// girok = WORK ON+ 기본 단어 빌드(노조 색 단어를 뺀 얼굴, app/brand/girok-words.mjs). 이름·아이콘은 nojo와 같다.
// 노조 공간 앱 노조+(공지·투표 등)는 나중에 얼굴을 따로 더한다. 그때 쓸 옛 아이콘(J10)은 scripts/app-icon/nojoplus-j10.svg.
//
// menu: 켜진 메뉴 id(app/menu-model.mjs ITEMS의 id). views: 켜진 화면(라우터 이름).
//   단계 2에서는 목록만 둔다. 실제로 메뉴·경로를 빼고 서버가 거절하는 일은 단계 3(화면 숨김이 아니라 제거 + 서버 거절, AGENTS.md 5절).
// words: 노조 색 글자 → 이 얼굴의 글자. 화면 글자는 app/brand/brand.mjs의 word()를 거쳐 나온다.
//   girok 표는 app/brand/girok-words.mjs 한 곳(2026-11-20 사용자 결정 단어, S67-43). 바꿀 때는 그 표만 고친다.

import {GIROK_WORDS} from './girok-words.mjs';

const ALL_MENU = Object.freeze(['home', 'basket', 'reading', 'calendar', 'note', 'meetings', 'library', 'files', 'brief', 'team', 'hwp', 'photos', 'outside', 'calls', 'telegram', 'arsenal']);
const ALL_VIEWS = Object.freeze(['home', 'basket', 'reading', 'calendar', 'tasks', 'diary', 'projects', 'library', 'files', 'meetings', 'team', 'hwp', 'profile', 'updates', 'whatsnew', 'help', 'lock', 'feedback', 'signups', 'search', 'photos', 'brief', 'calls', 'telegram', 'arsenal', 'outside']);
// 기록+에서 빠지는 것(계획 '남기는 것 / 빼는 것'): News·브리핑 룸·아스날, 통화·텔레그램(원래 운영자 전용).
const GIROK_OFF = Object.freeze(['outside', 'brief', 'arsenal', 'calls', 'telegram']);

export const DEFAULT_FACE = 'nojo';

export const FACES = Object.freeze({
  nojo: Object.freeze({
    id: 'nojo',
    name: 'WORK ON+',
    shortName: 'WORK ON+',
    description: 'WORK ON+ — 일정·할 일·노트·자료를 한곳에',
    icon: 'app/app-icon.svg',
    themeColor: '#f3f1ea',
    backgroundColor: '#f3f1ea',
    menu: ALL_MENU,
    views: ALL_VIEWS,
    words: Object.freeze({})
  }),
  girok: Object.freeze({
    id: 'girok',
    name: 'WORK ON+',
    shortName: 'WORK ON+',
    description: 'WORK ON+ — 일정·할 일·노트·자료를 한곳에',
    icon: 'app/app-icon.svg',
    themeColor: '#eef0f1',
    backgroundColor: '#eef0f1',
    menu: Object.freeze(ALL_MENU.filter(id => !GIROK_OFF.includes(id))),
    views: Object.freeze(ALL_VIEWS.filter(id => !GIROK_OFF.includes(id))),
    words: GIROK_WORDS
  })
});

export const faceOf = id => FACES[Object.hasOwn(FACES, id) ? id : DEFAULT_FACE];

// 받침: 없음 0, ㄹ 8. 한글 음절이 아니면 -1.
const finalOf = ch => { const code = (ch || '').charCodeAt(0) - 0xac00; return code >= 0 && code < 11172 ? code % 28 : -1; };
const isSyllable = ch => finalOf(ch) >= 0;
const PARTICLES = [['을', '를'], ['은', '는'], ['과', '와'], ['이', '가']];
/** 바꾼 말(to) 바로 뒤 조사를 새 말 받침에 맞춘다. [바뀐 조사, 원래 조사 길이]. 조사가 아니면 null. */
function particleAfter(to, rest) {
  const f = finalOf(to.at(-1));
  if (f < 0) return null;
  const batchim = f > 0, rieul = f === 8;
  if (rest.startsWith('으로')) return [batchim && !rieul ? '으로' : '로', 2];
  if (rest[0] === '로' && !isSyllable(rest[1])) return [batchim && !rieul ? '으로' : '로', 1];
  for (const [withFinal, noFinal] of PARTICLES) {
    if ((rest[0] === withFinal || rest[0] === noFinal) && !isSyllable(rest[1])) return [batchim ? withFinal : noFinal, 1];
  }
  return null;
}
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const finders = new WeakMap();
function finderOf(words) {
  if (!finders.has(words)) {
    const keys = Object.keys(words).filter(key => key && !key.includes('#')).sort((a, b) => b.length - a.length);
    finders.set(words, keys.length ? new RegExp(keys.map(escape).join('|'), 'g') : null);
  }
  return finders.get(words);
}
/** 글자 안의 표 열쇠를 긴 것부터 바꾼다. 표가 비면 글자 그대로. */
function replaceIn(words, text) {
  const finder = finderOf(words);
  if (!finder || !text) return text;
  let out = '', at = 0;
  finder.lastIndex = 0;
  for (let match = finder.exec(text); match; match = finder.exec(text)) {
    const to = words[match[0]];
    out += text.slice(at, match.index) + to;
    at = match.index + match[0].length;
    const particle = particleAfter(to, text.slice(at));
    if (particle) { out += particle[0]; at += particle[1]; }
    finder.lastIndex = at;
  }
  return out + text.slice(at);
}

/** 이 얼굴에서 노조 색 글자가 어떻게 보이나. slot: 같은 글자를 자리마다 다르게('title' 등). 표가 빈 얼굴은 글자 그대로. */
export function wordIn(face, text, slot) {
  if (typeof text !== 'string' || !text) return text;
  const words = face.words;
  if (slot && Object.hasOwn(words, `${text}#${slot}`)) return words[`${text}#${slot}`];
  if (Object.hasOwn(words, text)) return words[text];
  return replaceIn(words, text);
}
