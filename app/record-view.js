// ED③ 기록: draws the saved form (doc) of an organization record inside its list row. The list builds its rows as text; a row with a
// saved form carries an empty box [data-rec-doc="<id>"] that this fills with the one shared drawing (ed-render.mjs). A row without doc is
// not touched (it reads the old way). Nothing here saves.
import {renderDoc} from './ed-render.mjs';
import {hasDoc} from './record-doc.mjs';

function ensureStyles() {
  const have = [...document.querySelectorAll('link[rel="stylesheet"]')].some(l => (l.getAttribute('href') || '').split('?')[0].endsWith('ed-doc.css'));
  if (have) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = './ed-doc.css'; link.dataset.kptuViewStyle = '1'; document.head.append(link);
}
export function fillDocViews(host, rows) {
  if (!host) return 0;
  const byId = new Map((rows || []).filter(hasDoc).map(row => [String(row.id), row]));
  let count = 0;
  for (const box of host.querySelectorAll('[data-rec-doc]')) {
    const row = byId.get(box.dataset.recDoc);
    if (!row) continue;
    box.replaceChildren(renderDoc(row.doc)); count += 1;
  }
  if (count) ensureStyles();
  return count;
}
