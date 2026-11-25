// WEEKLY-처음시작고르기(시안 docs/design/mockups/weekly-start-choice.html ★A안, 명진 11/17 11:52 "ㅇ" = 추천대로):
// 바탕(자료실 확정본)도 '내 양식'도 없는 사람의 [주간 보고] 첫 화면 — 위 한 줄 [파일 올리기](한글 .hwpx·.hwp, 끌어 놓기는 바깥 상자가 받음),
// 아래 번호 4개(1 간단형·2 사업별 표·3 조직별·4 직접 만들기, 이름·순서 시안 그대로)와 작은 미리보기, 맨 아래 [이 모양으로 시작].
// 번호는 바로 저장하지 않는다 — 부르는 쪽(journal.js paintBlank)이 [양식 수정] 화면(weekly-own-form-edit.js)을 그 모양으로 연다.
// 이 함수는 마디만 만들어 돌려준다(그리는 자리·상태 주인은 journal.js paintBlank 한 곳). 상태는 메모리만(브라우저 저장소 없음).
// WEEKLY-처음시작여러개(명진 11/17 16:04 "복수선택 가능해야할 듯"): 1~3은 여러 개 고르기, 4 직접 만들기는 혼자만(규칙은 모델 togglePick), 0개면 [이 모양으로 시작] 못 누름.
// 쓴 공용 부품: button.secondary([파일 올리기]·[취소]), button.primary([이 모양으로 시작]), 기본 <input type="checkbox">(키보드·터치 그대로).
import {START_CHOICES, START_DEFAULT, startPicks, togglePick} from './weekly-own-form-model.mjs';
import {putUploadLabel} from './upload-label.mjs';

let seq = 0; // 한 화면에 둘이 있어도 체크 묶음 이름·제목 id가 겹치지 않게
export const START_TEXT = Object.freeze({
  file: '예전에 쓴 주간 보고 파일이 있나요? 올리면 그 모양 그대로 만들어요.',
  fileHint: '한글(.hwpx·.hwp) · 끌어 놓아도 돼요',
  pick: '파일 업로드',
  ask: '파일이 없으면, 어떤 모양으로 만들까요? (여러 개 선택해도 돼요)',
  later: '나중에 [양식 수정]에서 바꿀 수 있어요.',
  start: '이 모양으로 시작',
  own: '(직접)',
});

// → <section data-weekly-start>. onPick(): 파일 고르기 창 열기. onStart(keys): 고른 번호 목록(번호 순서)으로 [양식 수정] 열기. onCancel 이 있으면 [취소](다시 고르는 중일 때만).
// selected: 처음 켜 둘 번호 열쇠 하나 또는 목록(없으면 기본 1).
export function startChoiceEl(doc, {selected = START_DEFAULT, busy = false, onPick, onStart, onCancel} = {}) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let chosen = startPicks(selected);
  if (!chosen.length) chosen = [START_DEFAULT];
  const box = el('section', 'journal-weekly-start'); box.dataset.weeklyStart = '';
  const file = el('p', 'journal-weekly-blank-line journal-weekly-start-file');
  const pick = el('button', 'secondary', START_TEXT.pick); putUploadLabel(pick, START_TEXT.pick); pick.type = 'button'; pick.dataset.weeklyBlankPick = ''; pick.disabled = busy;
  pick.addEventListener('click', () => onPick?.());
  file.append(el('span', 'journal-weekly-start-file-text', `${START_TEXT.file} `), el('span', 'journal-muted', START_TEXT.fileHint), pick);
  const ask = el('p', 'journal-weekly-start-ask', START_TEXT.ask); ask.id = `weekly-start-ask-${++seq}`;
  const opts = el('div', 'journal-weekly-start-opts'); opts.setAttribute('role', 'group'); opts.setAttribute('aria-labelledby', ask.id);
  const name = `${ask.id}-pick`;
  for (const c of START_CHOICES) {
    const opt = el('label', 'journal-weekly-start-opt'); opt.dataset.weeklyStartOpt = c.key;
    const check = el('input'); check.type = 'checkbox'; check.name = name; check.value = c.key;
    check.addEventListener('change', () => { chosen = togglePick(chosen, c.key, check.checked); paintOn(); });
    const head = el('span', 'journal-weekly-start-opt-head');
    head.append(check, el('b', '', `${c.no}. ${c.name}`), el('small', 'journal-muted', c.desc));
    opt.append(head, previewEl(c.preview));
    opts.append(opt);
  }
  const foot = el('div', 'journal-weekly-start-foot');
  foot.append(el('span', 'journal-muted', START_TEXT.later));
  if (onCancel) { const cancel = el('button', 'secondary', '취소'); cancel.type = 'button'; cancel.dataset.weeklyStartCancel = ''; cancel.addEventListener('click', () => onCancel()); foot.append(cancel); }
  const go = el('button', 'primary', START_TEXT.start); go.type = 'button'; go.dataset.weeklyStartGo = ''; go.disabled = busy;
  go.addEventListener('click', () => { if (chosen.length) onStart?.([...chosen]); });
  foot.append(go);
  box.append(file, ask, opts, foot);
  // 한 곳에서만 그린다: 체크 표시·테두리·[이 모양으로 시작] 누를 수 있는지 모두 chosen 하나에서.
  function paintOn() {
    for (const o of opts.children) {
      const on = chosen.includes(o.dataset.weeklyStartOpt);
      o.classList.toggle('is-on', on); o.querySelector('input').checked = on;
    }
    go.disabled = busy || !chosen.length;
  }
  paintOn();
  return box;

  // 작은 미리보기(지어낸 예시 글). 노란 칸 = 그 주 기록에서 자동으로 채워지는 곳, '(직접)' = 사람이 쓰는 곳. 화면 읽기 프로그램에는 이름·설명만 읽힌다.
  function previewEl(parts) {
    const pv = el('div', 'journal-weekly-start-pv'); pv.setAttribute('aria-hidden', 'true');
    const cell = (tag, c) => { const n = el(tag, c.filled ? 'is-filled' : 'is-own', c.text || START_TEXT.own); return n; };
    for (const p of parts) {
      if (p.columns) {
        const t = el('table'); const hr = el('tr');
        for (const h of p.columns) hr.append(el('th', '', h));
        t.append(hr);
        for (const r of p.rows) { const tr = el('tr'); for (const c of r) tr.append(cell('td', c)); t.append(tr); }
        pv.append(t);
      } else {
        if (p.title) pv.append(el('b', '', p.title));
        for (const l of p.lines) pv.append(cell('span', l));
      }
    }
    return pv;
  }
}
