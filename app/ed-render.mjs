// ED-통합편집기 ①a: draws a saved document (ed1) as reading DOM, without the editor library. Web2 read views and the Web1
// page reader (through sr-render.mjs) use this one drawing, with the look in ed-doc.css (class names ed-*).
// Safety: the document is cleaned first (ed-schema.mjs cleanDoc, an allowlist); everything is drawn with createElement and
// textContent; links open only http(s)·mailto in a new tab with noopener. A shared-page photo is drawn as an image only when
// the reader passes a short-lived https address for that id (ED-② the Web1 reader gets them from the page-read function); without
// one it stays a place with its description. Nothing else is ever fetched.
// The Web1 reader imports this file, so it keeps to syntax older Samsung Internet parses: no ?. ?? replaceChildren
// structuredClone .at( (BUG-공유페이지삼성). Class and id names never contain "share".
import {cleanDoc, safeHref, widthsOfRow, tableLayout, pagePhotoId} from './ed-schema.mjs';

function make(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
// ED-기본기보강: center·right·justify and indent 1–8 (cleanDoc already allowed only these values).
function withAlign(node, attrs) {
  if (attrs && (attrs.align === 'center' || attrs.align === 'right' || attrs.align === 'justify')) node.classList.add('ed-' + attrs.align);
  if (attrs && attrs.indent > 0) node.classList.add('ed-indent-' + attrs.indent);
  return node;
}
// The address handed in for one photo src, only when it is an https address.
function photoAddress(src) {
  var id = pagePhotoId(src);
  if (!id || !MEDIA) return '';
  var url = Object.prototype.hasOwnProperty.call(MEDIA, id) ? MEDIA[id] : '';
  return typeof url === 'string' && url.indexOf('https://') === 0 ? url : '';
}
var MEDIA = null;
var MARK_TAG = {strong:'strong', em:'em', underline:'u', strike:'s'};

function inline(parent, list) {
  for (var i = 0; i < (list || []).length; i++) {
    var n = list[i];
    if (n.type === 'hard_break') { parent.appendChild(document.createElement('br')); continue; }
    var node = document.createTextNode(n.text || ''), marks = n.marks || [];
    for (var m = marks.length - 1; m >= 0; m--) {
      var mark = marks[m], wrap;
      if (mark.type === 'link') {
        var href = safeHref(mark.attrs && mark.attrs.href);
        if (!href) continue;
        wrap = make('a', 'ed-link');
        wrap.href = href; wrap.target = '_blank'; wrap.rel = 'noopener noreferrer';
      } else if (mark.type === 'color') wrap = make('span', 'ed-c ed-c-' + mark.attrs.color);
      else if (mark.type === 'highlight') wrap = make('mark', 'ed-hl ed-hl-' + mark.attrs.color);
      else if (MARK_TAG[mark.type]) wrap = make(MARK_TAG[mark.type]);
      else continue;
      wrap.appendChild(node);
      node = wrap;
    }
    parent.appendChild(node);
  }
  return parent;
}

function block(n) {
  var a = n.attrs || {};
  switch (n.type) {
    case 'paragraph': return withAlign(inline(make('p', 'ed-p ed-' + (a.style || 'body2')), n.content), a);
    case 'heading': return withAlign(inline(make('h' + (a.level + 1), 'ed-h ed-h' + a.level), n.content), a);
    case 'blockquote': return blocks(make('blockquote', 'ed-quote'), n.content);
    case 'bullet_list': return blocks(make('ul', 'ed-ul ed-ul-' + (a.marker || 'auto')), n.content);
    case 'ordered_list': {
      var ol = blocks(make('ol', 'ed-ol ed-ol-' + (a.marker || 'auto')), n.content);
      if (a.order && a.order !== 1) ol.setAttribute('start', String(a.order));
      return ol;
    }
    case 'list_item': return blocks(make('li'), n.content);
    case 'horizontal_rule': return make('hr', 'ed-hr');
    case 'code_block': {
      var pre = make('pre', 'ed-code'), text = '';
      for (var i = 0; i < (n.content || []).length; i++) text += n.content[i].text || '';
      pre.appendChild(make('code', '', text));
      return pre;
    }
    case 'image': {
      var address = photoAddress(a.src);
      if (address) {
        var pic = withAlign(make('figure', 'ed-photo'), {align:'center'});
        var img = make('img', 'ed-photo-img');
        img.alt = a.alt || '';
        img.setAttribute('loading', 'lazy');
        img.setAttribute('decoding', 'async');
        img.setAttribute('referrerpolicy', 'no-referrer');
        img.src = address;
        pic.appendChild(img);
        if (a.alt) pic.appendChild(make('figcaption', 'ed-photo-cap', a.alt));
        return pic;
      }
      var fig = withAlign(make('figure', 'ed-photo is-place'), {align:'center'});
      // ED③ 노트: a note photo (drive:<file id>) is drawn as a place here; the owner-only note screen fills it from the note's own
      // attachments (basket-notes.js). The id is not an address, and Web1 never has such photos.
      if (typeof a.src === 'string' && a.src.indexOf('drive:') === 0) fig.setAttribute('data-ed-drive', a.src.slice(6));
      fig.setAttribute('role', 'img');
      fig.setAttribute('aria-label', a.alt ? '사진: ' + a.alt : '사진');
      fig.appendChild(make('span', 'ed-photo-mark', '사진'));
      if (a.alt) fig.appendChild(make('figcaption', 'ed-photo-cap', a.alt));
      return fig;
    }
    case 'table': {
      var wrap = make('div', 'ed-table-wrap'), table = make('table', 'ed-table'), body = make('tbody');
      // Column widths dragged in the editor: the same proportions for every reader (ed-schema.mjs tableLayout).
      var first = (n.content || [])[0], firstCells = [];
      for (var f = 0; first && f < (first.content || []).length; f++) firstCells.push(first.content[f].attrs || {});
      var lay = tableLayout(widthsOfRow(firstCells));
      if (lay) {
        table.classList.add('ed-fixed');
        table.style.width = lay.width + 'px';
        var group = make('colgroup');
        for (var k = 0; k < lay.cols.length; k++) { var col = make('col'); col.style.width = lay.cols[k]; group.appendChild(col); }
        table.appendChild(group);
      }
      for (var r = 0; r < (n.content || []).length; r++) {
        var row = make('tr'), cells = n.content[r].content || [];
        for (var c = 0; c < cells.length; c++) {
          var cell = blocks(make(cells[c].type === 'table_header' ? 'th' : 'td'), cells[c].content);
          var ca = cells[c].attrs || {};
          if (ca.colspan > 1) cell.setAttribute('colspan', String(ca.colspan));
          if (ca.rowspan > 1) cell.setAttribute('rowspan', String(ca.rowspan));
          row.appendChild(cell);
        }
        body.appendChild(row);
      }
      table.appendChild(body);
      wrap.appendChild(table);
      return wrap;
    }
    default: return null;
  }
}
function blocks(parent, list) {
  for (var i = 0; i < (list || []).length; i++) {
    var node = block(list[i]);
    if (node) parent.appendChild(node);
  }
  return parent;
}

// The document as one <div class="ed-doc">. A value that is not a document draws an empty box.
// media: {photo id: https address} for the photos of this page, or nothing.
export function renderDoc(value, media) {
  var box = make('div', 'ed-doc');
  var clean = cleanDoc(value);
  MEDIA = media && typeof media === 'object' ? media : null;
  try { if (clean) blocks(box, clean.doc.content); } finally { MEDIA = null; }
  return box;
}
