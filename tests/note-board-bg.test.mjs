// S71-50 NOTE-보드배경색(사용자 2026-11-26 19:51 "보드 배경색상도 지정가능하게 해줘요"): 보드마다 바탕색.
// - 색 이름 목록이 화면 모델(note-boards-model.mjs)·화면 기억 검사(view-prefs.js)·DB 검사(migration)·CSS(theme-tokens.css·basket.css) 모두 같다.
// - 밝은·어두운 화면 모두 글자(밝은 화면 진한 글자 · 어두운 화면 밝은 글자)와 바탕 대비 4.5:1 이상, 흰 카드와 구별되게 흰색이 아니다.
// - 고르기·기본으로 되돌리기·목록 밖 색 거절·지운 보드 정리 모양.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BOARD_BGS, BOARD_BG_NAMES, parseBoardBgs, boardBgOf, withBoardBg, boardBgsToPrefs} from '../app/note-boards-model.mjs';
import {NOTE_BOARD_BGS, validValue} from '../app/view-prefs.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const lum = hex => { const v = hex.replace('#', '').match(/../g).map(h => parseInt(h, 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('색 이름 여덟 가지가 모델·화면 기억 검사·DB 검사·CSS에서 같다', () => {
  assert.deepEqual([...BOARD_BGS], ['sand', 'sage', 'sky', 'lilac', 'peach', 'mint', 'rose', 'gray']);
  assert.deepEqual([...NOTE_BOARD_BGS], [...BOARD_BGS]);
  assert.deepEqual(Object.keys(BOARD_BG_NAMES), [...BOARD_BGS]);
  const sql = read('supabase/migrations/20261126220000_profile_view_prefs_note_board_bg.sql');
  const db = [...sql.match(/@\.value\.type\(\) != "string" \|\| !\(([^)]*)\)\)/)[1].matchAll(/@\.value == "([a-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(db, [...BOARD_BGS]);
  const css = read('app/basket.css');
  for (const c of BOARD_BGS) assert.match(css, new RegExp(`\\.nb-scroll\\[data-nb-bg="${c}"\\] \\{ --nb-board-bg:var\\(--ds-board-bg-${c}\\); \\}`), c);
});

test('밝은·어두운 화면 모두 바탕색과 글자 대비 4.5:1 이상, 흰 카드와 다른 색', () => {
  const css = read('app/theme-tokens.css');
  const dark = css.indexOf('@media (prefers-color-scheme:dark)');
  const light = css.slice(0, dark), night = css.slice(dark);
  const pick = (src, name) => src.match(new RegExp(`${name}:(#[0-9a-f]{6})`))?.[1];
  // 화면 색 10가지의 진한 글자(밝은 화면)·어두운 공통 밝은 글자.
  const inks = [...light.matchAll(/--kptu-ink:(#[0-9a-f]{6})/g)].map(m => m[1]);
  assert.ok(inks.length >= 2);
  const nightInk = pick(night, '--kptu-ink');
  for (const c of BOARD_BGS) {
    const day = pick(light, `--ds-board-bg-${c}`), dk = pick(night, `--ds-board-bg-${c}`);
    assert.ok(day && dk, c);
    for (const ink of inks) assert.ok(contrast(day, ink) >= 4.5, `${c} ${day} / ${ink}`);
    assert.ok(contrast(dk, nightInk) >= 4.5, `${c} dark ${dk} / ${nightInk}`);
    assert.notEqual(day, '#ffffff'); assert.ok(contrast(day, '#ffffff') > 1.05, `${c}는 흰 카드와 구별`);
  }
});

test('고르기·기본으로 되돌리기·목록 밖 색 거절·서버 값 다듬기', () => {
  let bgs = {};
  bgs = withBoardBg(bgs, 'b1a2b3c4', 'sage');
  assert.deepEqual(bgs, {b1a2b3c4:'sage'});
  assert.equal(boardBgOf(bgs, 'b1a2b3c4'), 'sage');
  assert.equal(boardBgOf(bgs, 'b9z9z9z9'), null);
  assert.deepEqual(boardBgsToPrefs(bgs), {b1a2b3c4:'sage'});
  assert.equal(validValue('note_board_bg', boardBgsToPrefs(bgs)), true);
  bgs = withBoardBg(bgs, 'b1a2b3c4', null);
  assert.deepEqual(bgs, {});
  assert.equal(boardBgsToPrefs(bgs), null, '기본만 남으면 칸을 지운다');
  assert.throws(() => withBoardBg({}, 'b1a2b3c4', 'red'), /목록에 없는 색/);
  assert.throws(() => withBoardBg({}, 'b1a2b3c4', '#ff0000'), /목록에 없는 색/);
  assert.throws(() => withBoardBg({}, 'all', 'sand'), /보드를 찾지/);
  // 서버 값: 모양이 틀린 칸·목록 밖 색·없는 보드는 버린다.
  assert.deepEqual(parseBoardBgs({b1a2b3c4:'sand', b2b2b2b2:'red', bad:'sky', b3c3c3c3:1}), {b1a2b3c4:'sand'});
  assert.deepEqual(parseBoardBgs({b1a2b3c4:'sand', b2b2b2b2:'mint'}, [{id:'b2b2b2b2', name:'x'}]), {b2b2b2b2:'mint'});
  for (const v of [null, 'sand', ['sand'], 1]) assert.deepEqual(parseBoardBgs(v), {});
  // 화면 기억 검사도 같은 규칙(빈 객체·목록 밖 색 거절).
  for (const v of [{}, {b1a2b3c4:'red'}, {b1a2b3c4:null}, {all:'sand'}, null]) assert.equal(validValue('note_board_bg', v), false, JSON.stringify(v));
});
