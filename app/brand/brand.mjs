// APP-올인원다이어리 단계 2·3: 이 배포물의 얼굴. 화면 글자의 노조 색 단어는 word()를 거쳐 나온다.
// 얼굴은 빌드가 face.mjs 한 줄로 정한다(scripts/brand-face.mjs). 주소·기기 저장소·사용자 조작으로 바꾸는 길은 두지 않는다.
//
// 쓰는 법(노동조합+ 얼굴에서는 모두 글자 그대로):
//   word('조직 관리')            고정 글자 하나
//   word('조직 관리', 'title')   같은 글자를 자리마다 다르게(표의 '조직 관리#title')
//   word`${name} 담당조직`        사용자 글이 섞일 때: 고정 조각만 바꾸고 ${값}은 그대로 둔다
import {FACE_ID} from './face.mjs';
import {faceOf, wordIn} from './faces.mjs';

export const FACE = faceOf(FACE_ID);
export const APP_NAME = FACE.name;
export const word = (text, ...rest) => {
  if (Array.isArray(text) && Array.isArray(text.raw)) {
    let out = wordIn(FACE, text[0]);
    for (let i = 1; i < text.length; i += 1) out += String(rest[i - 1]) + wordIn(FACE, text[i]);
    return out;
  }
  return wordIn(FACE, text, rest[0]);
};
