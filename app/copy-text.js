// Copy letters (and, for 한글, HTML) to the clipboard. Shared by the write window and the read views.
// Also used by the note read view's [텔레그램용 복사]. With html (8-11a [한글용 복사]) the clipboard gets both kinds:
// text/html for programs that read formatting (한글 keeps bold and makes a real table) and text/plain for the rest.
export async function copyText(text, {html = null} = {}) {
  try {
    if (html == null) await navigator.clipboard.writeText(text);
    else await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([html], {type: 'text/html'}), 'text/plain': new Blob([text], {type: 'text/plain'})})]);
    return true;
  } catch {}
  // Older WebViews: a hidden read-only text field and the copy command; with html the copy event carries both kinds.
  const area = document.createElement('textarea');
  area.value = text; area.setAttribute('readonly', ''); area.className = 'a11y-only';
  const both = e => {
    if (!e.clipboardData) return;
    e.clipboardData.setData('text/plain', text); e.clipboardData.setData('text/html', html); e.preventDefault();
  };
  if (html != null) document.addEventListener('copy', both, true);
  document.body.append(area); area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  document.removeEventListener('copy', both, true);
  area.remove();
  return ok;
}
