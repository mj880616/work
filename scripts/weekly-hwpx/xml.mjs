// WEEKLY-한글초안 시제품: OWPML XML을 읽고 쓰는 최소 도구(외부 라이브러리 없음). DTD·CDATA·엔터티 정의는 OWPML에 없어 받지 않는다.
// 노드: {name, attrs:{}, children:[]} / 글자: {text}. 이름공간 접두어는 그대로 둔다(hp:p 등).

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  if (!(e in ENTITIES)) throw new Error(`xml: 알 수 없는 엔터티 ${m}`);
  return ENTITIES[e];
});
export const escapeText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeAttr = s => escapeText(s).replace(/"/g, '&quot;');

// 잘못된 XML(닫히지 않은 태그, 짝이 안 맞는 태그, 루트 둘 이상)은 Error. 선언(<?xml …?>)은 prolog로 보관.
export function parseXml(src) {
  let i = 0;
  let prolog = '';
  const root = {name: '#root', attrs: {}, children: []};
  const stack = [root];
  const ATTR = /\s*([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/y;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { if (src.slice(i).trim()) throw new Error('xml: 루트 밖 글자'); break; }
    if (lt > i) {
      const text = src.slice(i, lt);
      if (stack.length > 1) stack[stack.length - 1].children.push({text: decode(text)});
      else if (text.trim()) throw new Error('xml: 루트 밖 글자');
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt);
      if (end < 0) throw new Error('xml: 선언이 닫히지 않음');
      if (stack.length === 1 && !root.children.length) prolog = src.slice(lt, end + 2);
      i = end + 2; continue;
    }
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      if (end < 0) throw new Error('xml: 주석이 닫히지 않음');
      i = end + 3; continue;
    }
    if (src.startsWith('<!', lt)) throw new Error('xml: DTD·CDATA는 받지 않음');
    if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      const name = src.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error(`xml: 닫는 태그 불일치 </${name}>`);
      i = end + 1; continue;
    }
    let j = lt + 1;
    while (j < src.length && !/[\s/>]/.test(src[j])) j++;
    const node = {name: src.slice(lt + 1, j), attrs: {}, children: []};
    if (!node.name) throw new Error('xml: 빈 태그 이름');
    for (;;) {
      ATTR.lastIndex = j;
      const m = ATTR.exec(src);
      if (!m) break;
      if (m[1] in node.attrs) throw new Error(`xml: 속성 중복 ${m[1]}`);
      node.attrs[m[1]] = decode(m[3] ?? m[4]);
      j = ATTR.lastIndex;
    }
    while (/\s/.test(src[j])) j++;
    const parent = stack[stack.length - 1];
    if (parent === root && root.children.length) throw new Error('xml: 루트가 둘 이상');
    parent.children.push(node);
    if (src.startsWith('/>', j)) { i = j + 2; continue; }
    if (src[j] !== '>') throw new Error(`xml: <${node.name}> 태그가 잘못됨`);
    stack.push(node);
    i = j + 1;
  }
  if (stack.length !== 1) throw new Error(`xml: <${stack[stack.length - 1].name}> 닫히지 않음`);
  if (root.children.length !== 1) throw new Error('xml: 루트가 없음');
  return {prolog, root: root.children[0]};
}

export function serialize(node) {
  if ('text' in node) return escapeText(node.text);
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
  if (!node.children.length) return `<${node.name}${attrs}/>`;
  return `<${node.name}${attrs}>${node.children.map(serialize).join('')}</${node.name}>`;
}
export const toXml = (root, prolog = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>') => prolog + serialize(root);

export const kids = (node, name) => node.children.filter(c => c.name === name);
export const kid = (node, name) => node.children.find(c => c.name === name);
export function* walk(node) {
  yield node;
  for (const c of node.children || []) if (!('text' in c)) yield* walk(c);
}
export const textOf = node => [...walk(node)].filter(n => n.name === 'hp:t').map(t => t.children.map(c => c.text ?? '').join('')).join('');
export const clone = node => JSON.parse(JSON.stringify(node));
export const el = (name, attrs = {}, children = []) => ({name, attrs, children});
