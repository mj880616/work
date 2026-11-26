// S71-49 NOTE-보드붙여넣기(사용자 결정 2026-11-26 "보드 위에 좌클릭 후, CTRL + V 하면 클립보드에 저장된 이미지, 텍스트 붙여넣어지는거"):
// 노트 보드 붙여넣기 계산(화면 없음, 시험 가능). 붙이는 흐름은 note-board.js 하나.
// - PC에서 보드 빈 곳을 왼쪽 클릭한 자리 = 붙일 자리(판 좌표). 그 자리가 지금 보이는 판 밖이면 보이는 판 가운데.
// - 글자: 배경 없는 글자 칸 하나. 줄바꿈은 그대로, 탭은 빈칸, 다른 제어 문자는 뺀다. 칸 한도(TEXT_MAX자)를 넘으면 앞부분만(cut).
// 기기 저장 없음.
import { TEXT_MAX } from './note-board-links-model.mjs';

// 클립보드 글자 → {body, cut} 또는 null(넣을 글이 없음).
export function pastedText(raw, max = TEXT_MAX) {
  if (typeof raw !== 'string') return null;
  const clean = raw.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f​﻿]/g, '')
    .split('\n').map(line => line.replace(/\s+$/, '')).join('\n')
    .replace(/^[ \n]+|[ \n]+$/g, '');
  if (!clean) return null;
  const chars = [...clean];
  if (chars.length <= max) return {body:clean, cut:false};
  return {body:chars.slice(0, max).join('').replace(/[ \n]+$/, ''), cut:true};
}

// 붙일 자리: 누른 자리(at, 판 좌표)가 보이는 판(area = {x, y, w, h}, 판 좌표) 안이면 그 자리, 아니면 null(→ 부르는 쪽이 판 가운데).
export function pastePlace(at, area) {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y) || !area) return null;
  const inside = at.x >= area.x && at.y >= area.y && at.x <= area.x + area.w && at.y <= area.y + area.h;
  return inside ? {x:at.x, y:at.y} : null;
}

// 같은 자리에 또 붙이면 조금씩 비켜 놓는다(사진 여러 장 넣기와 같은 24px).
export const PASTE_STEP = 24;
export const nextPastePlace = at => (at ? {x:at.x + PASTE_STEP, y:at.y + PASTE_STEP} : null);
