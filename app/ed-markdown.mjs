// ED-통합편집기 ①a [서식으로 바꾸기]: markdown letters (an AI answer pasted as is) → the saved form's nodes (ed1), with no
// DOM. The caller passes a markdown-it instance (the one already vendored in app/markdown-lib, html off), so this file
// loads nothing. Headings 1–3 (4–6 become 3), bold·italic·strike·links (http(s)·mailto), lists with their start number,
// quotes, rules, tables with a head row, code as a code block (the letters stay). Images become "이미지: 설명 (주소)"
// letters (no outside photo is put in). Callout boxes "> [!NOTE]" become a quote starting with "참고:".
// Nothing is guessed when converting is not asked: the editor pastes the letters as they are (사용자 결정 3 가).
import {cleanDoc, safeHref, DEFAULT_BODY} from './ed-schema.mjs';

export const CALLOUTS = {NOTE:'참고', TIP:'팁', IMPORTANT:'중요', WARNING:'경고', CAUTION:'주의'};

function inlineNodes(children) {
  const out = [], marks = [];
  const add = text => { if (text) out.push(marks.length ? {type:'text', text, marks:marks.map(m => ({...m}))} : {type:'text', text}); };
  const open = mark => marks.push(mark);
  const close = type => { for (let i = marks.length - 1; i >= 0; i--) if (marks[i].type === type) { marks.splice(i, 1); return; } };
  for (const t of children || []) {
    switch (t.type) {
      case 'text': add(t.content); break;
      case 'code_inline': add(t.content); break;
      case 'softbreak': case 'hardbreak': out.push({type:'hard_break'}); break;
      case 'strong_open': open({type:'strong'}); break;
      case 'strong_close': close('strong'); break;
      case 'em_open': open({type:'em'}); break;
      case 'em_close': close('em'); break;
      case 's_open': open({type:'strike'}); break;
      case 's_close': close('strike'); break;
      case 'link_open': { const href = safeHref(t.attrGet('href')); open(href ? {type:'link', attrs:{href}} : {type:'nolink'}); break; }
      case 'link_close': close(marks.some(m => m.type === 'link') ? 'link' : 'nolink'); break;
      case 'image': { const alt = t.content || (t.children || []).map(c => c.content).join(''); add(`이미지: ${alt || '설명 없음'} (${t.attrGet('src') || ''})`); break; }
      case 'html_inline': add(t.content); break;
      default: if (t.content) add(t.content);
    }
  }
  return out.map(n => n.marks ? {...n, marks:n.marks.filter(m => m.type !== 'nolink')} : n).map(n => n.marks && !n.marks.length ? {type:n.type, text:n.text} : n);
}

// tokens → nodes. Returns [nodes, next index].
function parse(tokens, i, stop) {
  const out = [];
  while (i < tokens.length && tokens[i].type !== stop) {
    const t = tokens[i];
    switch (t.type) {
      case 'paragraph_open': {
        const inline = tokens[i + 1];
        out.push({type:'paragraph', attrs:{style:DEFAULT_BODY}, content:inlineNodes(inline.children)});
        i += 3; continue;
      }
      case 'heading_open': {
        const level = Math.min(3, Number(t.tag.slice(1)) || 2);
        out.push({type:'heading', attrs:{level}, content:inlineNodes(tokens[i + 1].children)});
        i += 3; continue;
      }
      case 'bullet_list_open': case 'ordered_list_open': {
        const [items, next] = parse(tokens, i + 1, t.type.replace('_open', '_close'));
        const node = {type:t.type === 'bullet_list_open' ? 'bullet_list' : 'ordered_list', content:items};
        if (node.type === 'ordered_list') node.attrs = {order:Number(t.attrGet('start')) || 1};
        out.push(node); i = next + 1; continue;
      }
      case 'list_item_open': {
        const [content, next] = parse(tokens, i + 1, 'list_item_close');
        // Tight lists hide their paragraph tokens: the inline token then sits right in the item.
        out.push({type:'list_item', content}); i = next + 1; continue;
      }
      case 'blockquote_open': {
        const [content, next] = parse(tokens, i + 1, 'blockquote_close');
        const first = content[0], lead = first && first.type === 'paragraph' && first.content && first.content[0];
        const m = lead && lead.type === 'text' && /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(lead.text);
        if (m) {
          const rest = lead.text.slice(m[0].length), name = CALLOUTS[m[1].toUpperCase()] + ':';
          const after = first.content.slice(1);
          if (after[0] && after[0].type === 'hard_break') after.shift();
          first.content = [{type:'text', text:name, marks:[{type:'strong'}]}, ...(rest ? [{type:'text', text:' ' + rest}] : after.length ? [{type:'text', text:' '}] : []), ...after];
        }
        out.push({type:'blockquote', content}); i = next + 1; continue;
      }
      case 'hr': out.push({type:'horizontal_rule'}); i++; continue;
      case 'fence': case 'code_block': out.push({type:'code_block', content:t.content.replace(/\n$/, '') ? [{type:'text', text:t.content.replace(/\n$/, '')}] : []}); i++; continue;
      case 'table_open': {
        const rows = []; let row = null, header = false; i++;
        while (i < tokens.length && tokens[i].type !== 'table_close') {
          const k = tokens[i];
          if (k.type === 'thead_open') header = true;
          else if (k.type === 'thead_close') header = false;
          else if (k.type === 'tr_open') row = [];
          else if (k.type === 'tr_close') { rows.push({type:'table_row', content:row}); row = null; }
          else if (k.type === 'th_open' || k.type === 'td_open') {
            row.push({type:header || k.type === 'th_open' ? 'table_header' : 'table_cell', content:[{type:'paragraph', attrs:{style:DEFAULT_BODY}, content:inlineNodes(tokens[i + 1].children)}]});
            i += 2;
          }
          i++;
        }
        out.push({type:'table', content:rows}); i++; continue;
      }
      case 'inline': out.push({type:'paragraph', attrs:{style:DEFAULT_BODY}, content:inlineNodes(t.children)}); i++; continue;
      case 'html_block': for (const line of t.content.replace(/\n$/, '').split('\n')) out.push({type:'paragraph', attrs:{style:DEFAULT_BODY}, content:line ? [{type:'text', text:line}] : []}); i++; continue;
      default: i++;
    }
  }
  return [out, i];
}

// Returns the cleaned saved form {v:'ed1', doc}.
export function markdownToDoc(markdownIt, text) {
  const tokens = markdownIt.parse(String(text == null ? '' : text).replace(/\r\n?/g, '\n'), {});
  const [content] = parse(tokens, 0, null);
  return cleanDoc({type:'doc', content});
}
// Plain letters → the saved form: one paragraph per line, nothing read as format (opening an old plain note, ③).
export function plainToDoc(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  return cleanDoc({type:'doc', content:lines.map(line => ({type:'paragraph', attrs:{style:DEFAULT_BODY}, content:line ? [{type:'text', text:line}] : []}))});
}

// ED③-창: opening an old plain text without changing its letters (설계 11.3). plainToDoc makes one paragraph per line, so toPlain
// puts a blank line between every two lines. Here a run of lines between blank lines is ONE paragraph and the line breaks inside it
// are hard_break nodes, so toPlain(plainToDocKeep(text)) gives the same lines back (a line of only spaces counts as blank, the
// way toPlain's own tidy-up does; extra blank lines in a row, trailing spaces and blank ends are the only things toPlain drops).
// Nothing is read as format: "1." "-" and dates stay letters.
export function plainToDocKeep(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  const chunks = [];
  let chunk = null;
  for (const line of lines) {
    if (!line.trim()) { chunk = null; continue; }
    if (!chunk) chunks.push(chunk = []);
    chunk.push(line);
  }
  const content = chunks.map(chunkLines => {
    const inline = [];
    chunkLines.forEach((line, i) => {
      if (i) inline.push({type:'hard_break'});
      inline.push({type:'text', text:line});
    });
    return {type:'paragraph', attrs:{style:DEFAULT_BODY}, content:inline};
  });
  return cleanDoc({type:'doc', content});
}
