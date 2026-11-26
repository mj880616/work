import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {filterChipText,selectedLabel,FILTER_CHIP_ALL} from '../app/report-filter-chip-model.mjs';
// S67-75 UI-걸러보기칩하나(2026-11-21 사용자 18:33 A안): 폰 사업 관리 윗줄 칩 하나의 글자와, #2847 끝 흐림(mask)을 걷어낸 것.
test('nothing picked reads 전체; picked values only, joined with · in screen order', () => {
  assert.equal(FILTER_CHIP_ALL, '전체');
  assert.equal(filterChipText([]), '전체');
  assert.equal(filterChipText([{label: '종류 전체', on: false, shown: true}, {label: '사업영역 전체', on: false, shown: true}, {label: '이번 주', on: false, shown: true}, {label: '목록', on: false, shown: true}]), '전체');
  assert.equal(filterChipText([{label: '회의', on: true, shown: true}, {label: '사업영역 전체', on: false, shown: true}, {label: '전체 기간', on: true, shown: true}, {label: '목록', on: false, shown: true}]), '회의 · 전체 기간');
});
test('a hidden box (no 사업영역, period in 달력 view) never adds its value', () => {
  assert.equal(filterChipText([{label: '합성 사업', on: true, shown: false}, {label: '달력', on: true, shown: true}]), '달력');
  assert.equal(filterChipText([{label: '  ', on: true, shown: true}]), '전체');
});
test('selectedLabel reads the chosen option, a hidden first option included', () => {
  const opt = (label, hidden = false) => ({label, textContent: label, hidden});
  assert.equal(selectedLabel({options: [opt('주 단위', true), opt('이번 주')], selectedIndex: 0}), '주 단위');
  assert.equal(selectedLabel({options: [opt('목록'), opt('달력')], selectedIndex: 1}), '달력');
  assert.equal(selectedLabel(null), '');
});
test('the #2847 fade on the 사업 관리 chip line is gone, and the chip sits on the top line', () => {
  const css = readFileSync('app/ui-standard.css', 'utf8'), html = readFileSync('app/index.html', 'utf8');
  assert.doesNotMatch(css, /rk-chip-fade|--rk-fade-|animation-timeline/);
  // S70-57: 첫 줄 아이콘·제목은 앱 머리 줄로 옮겨(찾기 돋보기와 함께) 칩 자리가 첫 줄 맨 앞이다.
  assert.match(html, /<div class="toolbar report-top-line"><span class="report-filter-slot"><button id="reportFilterChip" class="report-filter-chip" type="button"[^>]*aria-controls="reportFilterBar" hidden>/);
  assert.match(html, /<div id="reportFilterBar" class="toolbar report-kind-bar">/);
});
