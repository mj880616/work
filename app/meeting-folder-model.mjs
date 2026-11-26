// MTG-정기회의자료폴더(사용자 11/24 21:03 "자료실 폴더 이름 중 회의 폴더 이름이 정기 회의 폴더 이름과 같고 매칭이 되어서.
//   저기에 회의자료 등을 올리면 저 폴더로 자동으로 가게"): 정기 회의의 자료를 넣을 자료실 폴더를 고르는 규칙의 유일한 곳. 순수 함수만(화면·네트워크 없음).
// 1) 짝: 폴더 줄 meeting_key(서버 칸, migration 20261124213000)가 이 회의명 열쇠(nameKey — 회의명 정리와 같은 열쇠)와 같은 폴더. 휴지통 폴더는 보이는 목록에 없으므로 쓰지 않는다.
// 2) 짝이 없으면 이름이 같은 폴더: 띄어쓰기·가운뎃점·대소문자만 맞춰 같은 이름인 폴더가 정확히 하나일 때만(둘 이상이면 고르지 않음).
//    다른 회의와 짝지은 폴더는 이름이 같아도 쓰지 않는다.
// 3) 둘 다 없으면 null — 지금처럼(회의자료는 폴더 밖, 드라이브는 회의자료 폴더).
// 폴더·회의 이름은 코드에 박지 않는다(AGENTS.md 5절). 시험: tests/meeting-folder-model.test.mjs
import {nameKey, validNameKey} from './meeting-name-sorts.mjs';

// 이름 비교용: 앞뒤·가운데 띄어쓰기, 가운뎃점(·‧・ㆍ•∙⋅･), 대소문자만 무시한다.
const DOTS = /[\s·‧・ㆍ•∙⋅･]/gu;
export const folderNameKey = s => String(s ?? '').normalize('NFC').toLowerCase().replace(DOTS, '');

// 짝으로 저장할 열쇠(서버 검사와 같은 모양). 쓸 수 없는 이름이면 ''.
export function meetingLinkKey(name) {
  const key = nameKey(String(name ?? '').normalize('NFC'));
  return validNameKey(key) ? key : '';
}

// 사업 보고 줄의 회의명: 정기 회의 이름(series_name)이 있으면 그것, 없으면 제목.
export const meetingNameOf = meeting => String(meeting?.series_name || meeting?.title || '').trim();

// folders = 보이는 폴더 [{id,name}], links = [{id, meeting_key}] | null(서버 칸 없음), name = 회의명.
// 반환 {folder, how:'linked'|'same'} | null.
export function pickMeetingFolder({folders, links, name}) {
  const list = Array.isArray(folders) ? folders.filter(f => f?.id) : [];
  const key = meetingLinkKey(name), byId = new Map(list.map(f => [f.id, f]));
  if (!key) return null;
  const pairs = Array.isArray(links) ? links : [];
  const linked = pairs.find(l => l?.meeting_key === key && byId.has(l.id));
  if (linked) return {folder: byId.get(linked.id), how: 'linked'};
  const taken = new Set(pairs.filter(l => l?.meeting_key && l.meeting_key !== key).map(l => l.id));
  const want = folderNameKey(name);
  const same = list.filter(f => !taken.has(f.id) && folderNameKey(f.name) === want);
  return same.length === 1 ? {folder: same[0], how: 'same'} : null;
}

// 이 회의명과 짝지은 폴더(⋯ 메뉴의 지금 값 표시). 없으면 null.
export function linkedFolder({folders, links, name}) {
  const r = pickMeetingFolder({folders, links, name});
  return r?.how === 'linked' ? r.folder : null;
}

// 저장 뒤 한 줄. put = 넣은 수, failed = 못 넣은 수.
export function filedLine(folderName, put, failed = 0) {
  const name = String(folderName || '');
  if (put && failed) return `‘${name}’ 폴더에 넣었어요 ${put}개 · ${failed}개는 넣지 못했어요`;
  if (put) return `‘${name}’ 폴더에 넣었어요 ${put}개`;
  return failed ? `‘${name}’ 폴더에 넣지 못했어요. 자료실에서 옮겨 주세요.` : '';
}
