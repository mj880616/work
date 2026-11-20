// APP-올인원다이어리 단계 2·3: 이 배포물의 얼굴. 화면 글자의 노조 색 단어는 word()를 거쳐 나온다.
// 얼굴은 빌드가 face.mjs 한 줄로 정한다(scripts/brand-face.mjs). 주소·기기 저장소·사용자 조작으로 바꾸는 길은 두지 않는다.
// APP-기록+이름바꾸기(S67-44): 얼굴 기본값 위에 '내가 고친 이름'(서버 내 프로필, custom-words.mjs)을 얹는다.
//   고칠 수 있는 칸·뜻은 custom-words-model.mjs 한 곳. FACE는 얼굴 그대로(기본 이름), word()만 고친 이름을 쓴다.
//
// 쓰는 법(노동조합+ 얼굴에서는 고친 이름이 없으면 모두 글자 그대로):
//   word('조직 관리')            고정 글자 하나
//   word('조직 관리', 'title')   같은 글자를 자리마다 다르게(표의 '조직 관리#title')
//   word`${name} 담당조직`        사용자 글이 섞일 때: 고정 조각만 바꾸고 ${값}은 그대로 둔다
import {FACE_ID} from './face.mjs';
import {faceOf, wordIn} from './faces.mjs';
import {CUSTOM_WORDS} from './custom-words.mjs';
import {applyCustomWords} from './custom-words-model.mjs';

export const FACE = faceOf(FACE_ID);
export const APP_NAME = FACE.name;
const SHOWN = applyCustomWords(FACE, CUSTOM_WORDS);
/** 이번 접속에 얼굴 기본값과 다른 '내가 고친 이름'이 있나(없으면 모든 글자가 얼굴 그대로). */
export const CUSTOMIZED = SHOWN !== FACE;
export const word = (text, ...rest) => {
  if (Array.isArray(text) && Array.isArray(text.raw)) {
    let out = wordIn(SHOWN, text[0]);
    for (let i = 1; i < text.length; i += 1) out += String(rest[i - 1]) + wordIn(SHOWN, text[i]);
    return out;
  }
  return wordIn(SHOWN, text, rest[0]);
};
