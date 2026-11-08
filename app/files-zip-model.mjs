// S52-44 ⑤ FILES-관리자마무리(요청함 11/08 "파일 ⋯에 [여러 개 받기]"): 고른 파일 여러 개를 화면에서 zip 하나로 묶어 받기 — 계획 계산. DOM·네트워크 없음(node --test).
// - 파일만 묶는다(폴더는 빼고 한 줄로 알림). 바이트는 화면 메모리에서만 묶고(압축 없이 담기 — 사진·동영상·오피스는 이미 압축돼 있음), 서버·기기에 남기지 않는다.
// - 한 번에 ZIP_MAX_FILES개·모두 ZIP_MAX_BYTES까지(화면 메모리를 아끼려고). 넘으면 묶지 않고 줄여 달라고 한다.
// - 같은 이름은 '이름 (2).확장자'처럼 번호를 붙인다(공용 numberedName).
import {numberedName} from './file-rename-name.mjs';

export const ZIP_MAX_FILES = 100;
export const ZIP_MAX_BYTES = 500 * 1024 * 1024;
export function zipPlan(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const files = list.filter(r => r && !r.is_folder), folders = list.length - files.length;
  const total = files.reduce((n, r) => n + (Number(r.size_bytes) || 0), 0);
  let why = '';
  if (!files.length) why = '받을 파일이 없어요(폴더는 묶지 않아요)';
  else if (files.length > ZIP_MAX_FILES) why = `한 번에 ${ZIP_MAX_FILES}개까지 묶어 받아요. 나눠서 받아 주세요`;
  else if (total > ZIP_MAX_BYTES) why = '모두 500MB가 넘어 묶지 않아요. 나눠서 받아 주세요';
  const taken = [], names = files.map(r => { const n = numberedName(String(r.name || '파일'), taken); taken.push(n); return n; });
  return {ok: !why, why, files, names, folders, total};
}
// 받을 zip 이름: 고른 파일들이 같은 폴더면 그 폴더 이름, 아니면 '파일 n개'. 날짜를 붙인다('파일 3개 11-08.zip').
export function zipName(files, folderName = '', now = new Date()) {
  const day = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // eslint-disable-next-line no-control-regex
  const base = String(folderName || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim().slice(0, 60) || `파일 ${files.length}개`;
  return `${base} ${day}.zip`;
}
export const zipBusyText = (i, n) => `zip으로 묶는 중 ${i}/${n}`;
export const zipDoneText = (n, folders) => `${n}개를 zip 하나로 받았어요${folders ? ` (폴더 ${folders}개는 뺐어요)` : ''}`;
