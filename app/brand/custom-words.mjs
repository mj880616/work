// APP-기록+이름바꾸기(S67-44, docs/design/girok-custom-words.md): 이번 접속에서 쓰는 '내가 고친 이름'.
// 값은 서버 내 프로필 행(app_profiles.custom_words, owner RLS)에서만 온다. loader-v2.js가 로그인 확인 직후 한 번 읽어
// window.__KPTU_CUSTOM_WORDS__(읽기 약속)에 둔다. 이 모듈은 그 약속을 기다린 뒤에야 끝나므로, word()를 쓰는 화면 모듈은
// 첫 그리기 전에 이미 고친 이름을 안다(시작 순서: 설정 읽기 → 화면 첫 그리기, 늦게 와서 다시 덮어 그리지 않음).
// 주소·기기 저장소·화면 조작으로 바꾸는 길은 없다. 고친 이름을 저장하면 다음 열기부터 모든 화면에 보인다.
// 약속이 없거나(로그인 전 화면·시험) 실패·지연이면 고친 이름 없이(얼굴 기본값) 연다.
import {parseCustomWords} from './custom-words-model.mjs';

const pending = globalThis.__KPTU_CUSTOM_WORDS__;
export const CUSTOM_WORDS = parseCustomWords(pending && typeof pending.then === 'function' ? await pending.catch(() => null) : null);
