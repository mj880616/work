// HWP-서식변환: [노조 서식으로 만들기]가 편집기 칸막이 안에서 쓰는 보조 스크립트(studio-styles.js처럼 빌드 마무리 때 index.html에 넣는다).
// Web2 창이 보낸 메시지 하나만 받는다: 노조 양식 HWP 바이트 + 문단 목록(글·스타일 이름). 편집 중인 문서와 따로 같은 엔진으로 양식을 열어
// (① 누름틀 "제목"·"날짜"가 있으면 채우고 ② 본문 문단을 양식 맨 끝에 넣고 스타일을 입힌 뒤) HWP 바이트를 돌려준다. Web2 창이 그 바이트를
// 편집기에 열어 사람이 확인한다. 편집기 본체와 저장 흐름은 건드리지 않고, 네트워크·저장소는 쓰지 않는다(칸막이 CSP와 studio-guard.js 그대로).
// 엔진 클래스는 scripts/hwp-lab/expose-engine.mjs가 번들에 더한 window.rhwpStudio.engine.Document로 얻는다.
(() => {
  'use strict';
  const REQUEST = 'web2-hwp-convert';
  const RESULT = 'web2-hwp-convert-result';
  const MAX_PARAGRAPHS = 500;
  const MAX_TEXT = 2000;
  const MAX_BASE_BYTES = 30 * 1024 * 1024;
  const TITLE_FIELDS = ['제목', '문서제목', '표제'];
  const DATE_FIELDS = ['날짜', '작성일', '일자'];
  const TITLE_STYLE = '안건제목';
  const FALLBACK_STYLE = '바탕글';
  const squash = text => String(text ?? '').replace(/\s+/g, '');
  // 엔진 함수는 JSON 글자 또는 값을 돌려준다.
  const parse = value => (typeof value === 'string' ? JSON.parse(value) : value);
  const fail = (code, detail) => Object.assign(new Error(detail || code), {code});

  function validPlan(plan) {
    if (!plan || typeof plan !== 'object' || typeof plan.title !== 'string' || typeof plan.date !== 'string') return false;
    if (!Array.isArray(plan.paragraphs) || !plan.paragraphs.length || plan.paragraphs.length > MAX_PARAGRAPHS) return false;
    return plan.paragraphs.every(p => p && typeof p.text === 'string' && p.text.length > 0 && p.text.length <= MAX_TEXT && typeof p.style === 'string' && p.style.length <= 40);
  }

  // base: 양식 HWP 바이트, plan: {title, date, paragraphs:[{text, style}]}. Doc: 엔진 문서 클래스.
  // 돌려주는 것: {bytes, filled:[누름틀 이름], missing:[없어서 바탕글로 넣은 스타일 이름], inserted:넣은 문단 수}.
  function buildDocument(Doc, base, plan) {
    const doc = new Doc(base);
    try {
      try { doc.convertToEditable(); } catch { /* 편집기가 문서를 열 때 하는 준비. 이미 편집 가능한 문서면 없어도 된다. */ }
      const styles = parse(doc.getStyleList());
      const idByName = new Map();
      for (const style of styles) if (style && Number.isInteger(style.id) && !idByName.has(squash(style.name))) idByName.set(squash(style.name), style.id);
      const missing = new Set();
      const styleId = name => {
        const id = idByName.get(squash(name));
        if (id !== undefined) return id;
        missing.add(name);
        return idByName.get(squash(FALLBACK_STYLE));
      };

      // ① 누름틀: 제목·날짜 이름만 채운다. 채운 제목은 본문 맨 앞 제목 문단을 대신한다.
      const filled = [];
      let fields = [];
      try { fields = parse(doc.getFieldList()); } catch { fields = []; }
      let titleFilled = false;
      for (const field of Array.isArray(fields) ? fields : []) {
        const name = String(field?.name ?? '');
        const isTitle = TITLE_FIELDS.includes(name), isDate = DATE_FIELDS.includes(name);
        if ((!isTitle && !isDate) || filled.includes(name)) continue;
        try {
          doc.setFieldValueByName(name, isTitle ? plan.title : plan.date);
          filled.push(name);
          if (isTitle) titleFilled = true;
        } catch { /* 이 칸은 채우지 못했다. 본문에는 영향 없음 */ }
      }

      // ② 본문: 양식 맨 끝 구역의 마지막 문단부터. 마지막 문단이 비어 있으면 그 문단을 쓰고, 아니면 끝에서 문단을 나눠 이어 붙인다.
      const items = titleFilled ? plan.paragraphs : [{text: plan.title, style: TITLE_STYLE}, ...plan.paragraphs];
      const section = Math.max(0, Number(doc.getSectionCount()) - 1);
      let last = Number(doc.getParagraphCount(section)) - 1;
      if (!(last >= 0)) throw fail('empty_template');
      let reuse = Number(doc.getParagraphLength(section, last)) === 0;
      const placed = [];
      for (const item of items) {
        let para;
        if (reuse) { para = last; reuse = false; }
        else {
          doc.splitParagraph(section, last, Number(doc.getParagraphLength(section, last)));
          last += 1;
          para = last;
        }
        doc.insertText(section, para, 0, item.text);
        const id = styleId(item.style);
        if (id !== undefined) doc.applyStyle(section, para, id);
        placed.push({para, text: item.text});
      }
      // 넣은 문단을 다시 읽어 확인한다(빈 문단이 남았거나 문단 수가 어긋나면 결과를 쓰지 않는다).
      if (Number(doc.getParagraphCount(section)) !== last + 1) throw fail('paragraph_count');
      for (const row of placed) if (Number(doc.getParagraphLength(section, row.para)) === 0) throw fail('paragraph_empty');
      const bytes = doc.exportHwp();
      if (!bytes || !bytes.length) throw fail('export_empty');
      return {bytes, filled, missing: [...missing], inserted: placed.length};
    } finally {
      try { doc.free(); } catch { /* 이미 해제됨 */ }
    }
  }

  function onMessage(event) {
    const data = event.data;
    if (!data || data.type !== REQUEST || event.source !== window.parent || typeof data.id !== 'string') return;
    const reply = body => { try { window.parent.postMessage({type: RESULT, id: data.id, ...body}, '*'); } catch { /* 부모 창이 닫힘 */ } };
    try {
      const Doc = window.rhwpStudio?.engine?.Document;
      if (typeof Doc !== 'function') throw fail('no_engine');
      if (!(data.base instanceof Uint8Array) || !data.base.length || data.base.length > MAX_BASE_BYTES || !validPlan(data.plan)) throw fail('bad_request');
      reply({ok: true, ...buildDocument(Doc, data.base, data.plan)});
    } catch (error) {
      // 글 내용은 오류 글에 넣지 않는다.
      reply({ok: false, code: String(error?.code || 'engine_error')});
    }
  }
  window.addEventListener('message', onMessage);
  // 시험이 같은 코드를 부른다.
  window.__web2HwpConvert = Object.freeze({buildDocument, validPlan});
})();
