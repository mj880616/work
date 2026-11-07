// UI-보기탭한모양(S52-17, 2026-11-07 명진 13:26 "하단 탭 디자인 통일 제발 뭘 할 때 기존 디자인과 통일감 있게", 시안 docs/design/mockups/bottom-view-tabs.html 'ㅇ').
// 보기 탭(화면 안에서 보기를 바꾸는 칸 묶음)은 공용 ⑤ 보기 바꾸기(.ds-seg + button.ds-seg-btn) 하나로만 그린다.
// 이 검사기는 화면 코드에서 보기 탭 묶음을 찾는다: role="group"·role="tablist"이고 aria-label에 '보기'가 든 요소, 또는 role="tab" 버튼.
import {readFileSync, readdirSync} from 'node:fs';

const files = () => readdirSync('app').filter(f => /\.(m?js|html)$/.test(f)).map(f => `app/${f}`);
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}=(["'\`])([\\s\\S]*?)\\1`)) || [])[2];
const classOf = tag => attr(tag, 'class') || '';
const hasClass = (tag, c) => new RegExp(`(^|[\\s"'\`])${c}(?=[\\s"'\`$]|$)`).test(classOf(tag));

// 보기 탭 묶음 하나하나: {file, key(첫 클래스 또는 id), seg(ds-seg 여부), buttons:[ds-seg-btn 여부…]}
export function findViewTabs(file, src) {
  const out = [];
  for (const m of src.matchAll(/<(div|span|nav)\b([^>]*\brole=(["'])(group|tablist)\3[^>]*)>/g)) {
    const tag = m[2], label = attr(tag, 'aria-label') || '';
    if (!/보기/.test(label)) continue;
    const key = (classOf(tag).split(/\s+/)[0] || attr(tag, 'id') || label);
    // 묶음 바로 안의 버튼(닫는 태그까지): 같은 줄 템플릿 안에서 다음 '</div|</span|</nav' 전까지만 본다.
    const rest = src.slice(m.index + m[0].length);
    const end = rest.search(new RegExp(`</${m[1]}>`));
    const inner = end < 0 ? '' : rest.slice(0, end);
    const tags = [...inner.matchAll(/<button\b([^>]*)>/g)].map(b => b[1]);
    const buttons = tags.map(t => hasClass(t, 'ds-seg-btn'));
    const classes = [...new Set([...classOf(tag).split(/\s+/), ...tags.flatMap(t => classOf(t).split(/\s+/))].filter(c => /^[\w-]+$/.test(c)))];
    out.push({file, key, label, seg: hasClass(tag, 'ds-seg'), buttons, classes});
  }
  for (const m of src.matchAll(/<button\b([^>]*\brole=(["'])tab\2[^>]*)>/g)) {
    out.push({file, key: 'role=tab ' + (classOf(m[1]).split(/\s+/)[0] || '?'), label: '', seg: hasClass(m[1], 'ds-seg-btn'), buttons: [], classes: classOf(m[1]).split(/\s+/).filter(c => /^[\w-]+$/.test(c))});
  }
  return out;
}
export const scanViewTabs = () => files().flatMap(f => findViewTabs(f, readFileSync(f, 'utf8')));
export const isOneLook = t => t.seg && t.buttons.every(Boolean);
