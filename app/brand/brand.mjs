// APP-올인원다이어리 단계 2: 이 배포물의 얼굴. 화면 이름·메뉴 글자의 노조 색 단어는 word()를 거쳐 나온다.
// 얼굴은 빌드가 face.mjs 한 줄로 정한다(scripts/brand-face.mjs). 주소·기기 저장소·사용자 조작으로 바꾸는 길은 두지 않는다.
import {FACE_ID} from './face.mjs';
import {faceOf, wordIn} from './faces.mjs';

export const FACE = faceOf(FACE_ID);
export const APP_NAME = FACE.name;
export const word = text => wordIn(FACE, text);
