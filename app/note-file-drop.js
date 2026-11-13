// NOTE-목록에파일놓기(S61-16 ①): PC 파일을 노트 화면 오른쪽 목록(빈 자리·노트 줄·포스트잇 보기 포함)에 끌어 놓으면 새 노트 창.
// 이 부품은 '어디에 놓였나'와 '놓으면 새 노트' 표시만 맡는다. 파일을 받는 길(크기 제한·같은 파일 알림)은 새 노트 창의
// [📎 첨부]와 같은 basket-upload.js 하나이고, 저장은 그 창의 [저장]을 눌렀을 때만 한다(이 부품은 아무것도 저장하지 않는다).
//   zone      — 끌기를 듣는 칸(노트 화면 전체: 목록 아래 빈 자리도 받으려고)
//   target(e) — 이 끌기를 받을 목록 칸(표시를 붙일 곳) 또는 null(받지 않음: 위 입력칸·왼쪽 폴더 나무·노트가 열린 때 등)
//   onFiles(files) — 놓은 파일들(File 배열)
const LABEL = '여기 놓으면 새 노트';
const fileDrag = e => Array.from(e.dataTransfer?.types || []).includes('Files');

export function bindNoteFileDrop({zone, target, onFiles}) {
  const mark = document.createElement('p');
  mark.className = 'nx-file-drop'; mark.dataset.nxFileDrop = ''; mark.setAttribute('role', 'status'); mark.textContent = LABEL; mark.hidden = true;
  let on = null;
  const clear = () => { on?.classList.remove('nx-file-over'); on = null; mark.hidden = true; mark.remove(); };
  const show = el => {
    if (on === el) return;
    clear(); on = el; el.classList.add('nx-file-over'); el.prepend(mark); mark.hidden = false;
  };
  const take = e => {
    if (!fileDrag(e)) return null;
    const el = target(e);
    if (!el) { clear(); return null; }
    return el;
  };
  zone.addEventListener('dragenter', e => { const el = take(e); if (!el) return; e.preventDefault(); show(el); });
  zone.addEventListener('dragover', e => { const el = take(e); if (!el) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; show(el); });
  // 칸 밖으로 나가면(다른 앱 창으로 돌아가는 등) 표시를 지운다. 안쪽 칸 사이 이동은 relatedTarget이 zone 안이라 그대로 둔다.
  zone.addEventListener('dragleave', e => { if (!fileDrag(e)) return; if (!e.relatedTarget || !zone.contains(e.relatedTarget)) clear(); });
  zone.addEventListener('drop', e => {
    const el = take(e); clear();
    if (!el) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) onFiles(files);
  });
  window.addEventListener('dragend', clear);
  return {clear};
}

// 제목 칸 첫 값: 첫 파일 이름에서 확장자(마지막 '.' 뒤)를 뺀 것. 점으로 시작하는 이름('.env')이나 확장자가 없으면 그대로.
export function droppedTitle(files) {
  const name = String(files?.[0]?.name || '').replace(/[\r\n]+/g, ' ').trim();
  const dot = name.lastIndexOf('.');
  return [...(dot > 0 ? name.slice(0, dot) : name).trim()].slice(0, 200).join('');
}
