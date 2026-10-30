// MTG-결과마크다운: [⤢ 크게] beside a letters-only text box (사업 보고 '회의 결과 원문'·특이사항, 만들기·고치기 창) opens the one write
// window (ed-window.js, the note's editor: 블로그형 편집기 하나). The box keeps letters only (app_meetings has no saved-form column), so
//  - the window opens on the box's letters: a text with markdown marks is converted in memory (headings, lists, tables), any other
//    text opens exactly as written (plainToDocKeep). Nothing is saved by opening.
//  - [저장] in the window puts the text back into the box as markdown letters (ed-markdown-out.mjs docToMarkdown; a text with no
//    format comes back as the same letters) and closes. The box's own form save stays the only save to the server.
//  - Closing without saving leaves the box as it was.
// mountBigWrite(textarea, {title, placeholder, limit}) adds the button once, inside the box's label heading.
import {hasMarkdownMarks} from './note-preview.mjs';
import {guardDateLines} from './markdown-render.mjs';

const BIG_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

async function openBig(box, {title, placeholder, limit, trigger}) {
  const [{openEdWindow}, {loadMarkdownIt}, {markdownToDoc}, {docToMarkdown}, {bigWindowOpen}] = await Promise.all([
    import('./ed-window.js'), import('./ed-editor.js'), import('./ed-markdown.mjs'), import('./ed-markdown-out.mjs'), import('./big-window-open.js'),
    window.KPTUViewLoader?.prepare?.('basket')]);
  if (!box.isConnected || box.disabled || bigWindowOpen()) return;
  const text = box.value;
  let md = null;
  if (hasMarkdownMarks(text)) { try { md = await loadMarkdownIt(); } catch { md = null; } }
  if (!box.isConnected) return;
  openEdWindow({title, text, convert: md ? letters => markdownToDoc(md, guardDateLines(letters)) : null, limit, shortcuts: true,
    placeholder: placeholder || box.placeholder || '', label: title,
    save: {aria: '칸에 넣기', run: async ({value}) => {
      if (!box.isConnected) return {ok: false, message: '입력 창이 닫혔어요. 글을 복사해 두세요.'};
      const letters = docToMarkdown(value);
      if (limit > 0 && letters.length > limit) return {ok: false, message: `글이 너무 길어요. ${limit.toLocaleString('ko-KR')}자까지 넣을 수 있어요.`};
      box.value = letters;
      box.dispatchEvent(new Event('input', {bubbles: true}));
      return {ok: true};
    }},
    onClose: () => { if (trigger?.isConnected) trigger.focus({preventScroll: true}); }});
}

export function mountBigWrite(box, {title = '크게 쓰기', placeholder = '', limit = 0} = {}) {
  const label = box?.closest('label');
  if (!label || label.querySelector('.record-big-write')) return;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'ghost record-big-write';
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-label', '크게 쓰기'); button.title = '큰 창에서 쓰기';
  button.innerHTML = BIG_SVG;
  // Inside the label heading (before the box): a press on a button inside a label does not move focus to the box.
  const head = label.firstElementChild && label.firstElementChild !== box ? label.firstElementChild : null;
  if (head?.classList.contains('optional')) head.after(button); else if (head) head.append(button); else label.insertBefore(button, box);
  button.addEventListener('click', event => {
    event.preventDefault();
    void openBig(box, {title, placeholder, limit, trigger: button}).catch(() => { button.title = '큰 창을 열지 못했어요. 다시 눌러 주세요.'; });
  });
}
