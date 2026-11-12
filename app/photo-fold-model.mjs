// LIB-사진숨김(S60-10, 명진 결정 11/12, 시안 docs/design/mockups/photo-hide-thumbs.html): 그림·사진 파일은 목록 줄에서 기본으로 빼고
// 끝에 '사진 n' 하나만 두며, 누를 때만 작은 그림으로 보인다. 이 파일은 그 판정과 나누기만 하는 순수 규칙(DOM·네트워크 없음).
// - 파일 종류 판정은 [파일]과 같은 공용 판정 하나(files-model.mjs kindOf). 종류 'image'면 사진.
// - 숨기는 건 목록 줄 보이기뿐이다. 자료·파일은 그대로 있고, 자료 수·검색·사진 화면은 바뀌지 않는다(그리는 곳이 줄만 거른다).
// - 펼친 것은 기억하지 않는다(저장 없음). 화면을 새로 열면 늘 숨김으로 시작한다.
import {kindOf, KIND} from './files-model.mjs';

// 이름·mime으로 사진인가.
export const isPictureFile = ({name = '', mime = ''} = {}) => kindOf({name, mime}) === 'image';
// 자료 행(app_documents): Drive 파일이 있는 그림 자료만(작은 그림을 받을 수 있는 것). 파일 없이 주소만 적은 자료는 사진으로 보지 않는다.
export const isPictureDoc = doc => !!doc?.file_id && isPictureFile({name: doc.file_name, mime: doc.mime_type});

// 목록을 {rest: 사진 아닌 것(차례 그대로), pictures: 사진(차례 그대로)}로 나눈다.
export function splitPictures(list, isPicture) {
  const rest = [], pictures = [];
  for (const item of Array.isArray(list) ? list : []) (isPicture(item) ? pictures : rest).push(item);
  return {rest, pictures};
}

// 자료 줄의 파일 종류 표시(한글·PDF·워드·표·발표·동영상 …). 파일이 없거나 종류를 모르면 null(표시 안 함).
export function docKindBadge(doc) {
  if (!doc?.file_id && !doc?.file_name) return null;
  const key = kindOf({name: doc.file_name || '', mime: doc.mime_type || ''});
  if (key === 'file' || key === 'folder') return null;
  return {key, tone: TONE[key] || 'other', label: KIND[key].label};
}
// 색은 공용 파일 종류 표(ui-standard.css .file-kind[data-kind]) 이름으로 맞춘다.
const TONE = {pdf: 'pdf', hwp: 'hwp', excel: 'xls', word: 'doc', slide: 'ppt', image: 'img'};

export const pictureCountLabel = n => `사진 ${Math.max(0, n | 0)}`;
