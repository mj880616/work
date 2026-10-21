// S7-b 원장 가져오기 시험용 합성 시트(실제 원장 내용·조직·ID 아님). ID는 모두 09xx 번호대, 접두어는 가상.
// 단위 시험(tests/ledger-import-model.test.mjs), DB 시험(tests/auth-handoff/ledger-import.test.mjs), 화면 시험(tests/app-e2e/ledger-import.spec.mjs)이 같이 쓴다.
export const SHEET_TITLE = '가상 원장';
const csv = rows => rows.map(r => r.map(c => /[",\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c).join(',')).join('\r\n') + '\r\n';

export const TABS = {
  업무주제: [
    ['ID', '주제명', '별칭', '설명'],
    ['TOP-0901', '가상 철도 주제', '가상선, 시험선', '시험용'],
    ['TOP-0902', '가상 교섭 주제', '', '']
  ],
  조직: [
    ['ID', '조직명', '별칭', 'Web2연결ID', '비고'],
    ['ORG-0901', '가 지부', '가지부', '', ''],
    ['ORG-0902', '나 기관', '', '', '상대 기관']
  ],
  출처: [
    ['ID', '제목', '문서종류', '위치', '날짜', '처리상태', '민감도'],
    ['SRC-0901', '가상 회의자료', '회의자료', '가상 폴더', '2026-03-02', '부분처리', 'S1'],
    ['SRC-0902', '가상 통화 전사', '통화 전사', '', '2026.03.05', '완료', 'S2'],
    ['SRC-0903', '가상 민감 메모', '내부 문서', '', '', '', 'S3']
  ],
  사건: [
    ['ID', '제목', '요지', '기준일', '분야', '상태', '계속추적', '민감도', '중요도', '출처'],
    ['EVT-0901', '가상 노선 운영 변경', '가상 노선의 운영 방식이 바뀜', '2026-03', '가상 철도', '진행', 'Y', 'S1', '높음', 'SRC-0901~SRC-0902'],
    ['EVT-0902', '가상 교섭 시작', '', '2021~2025', '가상 교섭 주제', '종료', 'N', 'S2', '중간', ''],
    ['', '', '', '', '', '', '', '', '', ''],
    ['EVT-0903', '가상 민감 사건', '', '2026-04-01', '', '진행', 'Y', 'S3', '', '']
  ],
  변화기록: [
    ['ID', '사건ID', '제목', '기준일', '출처', '신문반영일'],
    ['CHG-0901', 'EVT-0901', '가상 노선 1차 협의', '2026-03-15', 'SRC-0901', '2026-03-16'],
    ['CHG-0902', 'EVT-0903', '가상 민감 사건 후속', '2026-04-02', '', '']
  ],
  결정: [
    ['ID', '제목', '결정유형', '결정이유', '기준일', '유효상태', '대체기록ID', '대체사유'],
    ['DEC-0901', '옛 가상 방침', '채택', '', '2025년', '대체', 'DEC-0902', '가상 사유'],
    ['DEC-0902', '새 가상 방침', '채택', '시험용 이유', '2026-04-01', '유효', '', '']
  ],
  근거: [
    ['ID', '제목', '유형', '근거위치', '출처', '신뢰도', '확인상태'],
    ['EVD-0901', '가상 통계 근거', '통계자료', '3쪽', 'SRC-0901', '높음', '부분확인'],
    ['EVD-0902', '가상 발언 근거', '사측 발언', '00:12', '가상 통화 전사', '', '']
  ],
  약속: [
    ['ID', '제목', '상대측', '이행상태', '후속확인일', '기준일'],
    ['COM-0901', '가상 기관 자료 제공 약속', '나 기관', '대기', '2026-05-01', '2026-04-10']
  ],
  조직연결: [
    ['ID', '기록ID', '조직ID', '관계유형'],
    ['LNK-0901', 'EVT-0901', 'ORG-0901', '직접 관련'],
    ['LNK-0902', 'COM-0901', 'ORG-0902', '상대 기관'],
    ['LNK-0903', 'EVT-0903', 'ORG-0901', '직접 관련']
  ],
  쓰기요청: [
    ['ID', '상태', '요청일시', '요청유형', '요지'],
    ['REQ-0901', '반영', '2026-03-02 10:30', '신규', '가상 요청 하나'],
    ['REQ-0902', '보류', '2026-03-03', '수정', '가상 요청 둘']
  ],
  검색인덱스: [['ID', '제목'], ['EVT-0901', '가상']]
};

// Google 시트 "다운로드 → CSV" 이름 모양: "<시트 이름> - <탭 이름>.csv"
export function csvFiles(tabs = TABS) {
  const encoder = new TextEncoder();
  return Object.entries(tabs).map(([name, rows]) => ({ name: `${SHEET_TITLE} - ${name}.csv`, bytes: encoder.encode('﻿' + csv(rows)) }));
}
export const csvText = rows => csv(rows);

// 시험용 최소 xlsx(저장 방식 zip, 공유 문자열 없이 inline 문자열). 시트 프로그램 xlsx와 같은 경로(xl/workbook.xml 등).
export function xlsxBytes(tabs = TABS) {
  const enc = new TextEncoder();
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const col = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const names = Object.keys(tabs);
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((n, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`],
    ...names.map((n, i) => [`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${tabs[n].map((r, y) => `<row r="${y + 1}">${r.map((c, x) => c === '' ? '' : `<c r="${col(x)}${y + 1}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`])
  ];
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const parts = []; const central = []; let offset = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const [name, text] of files) {
    const nameBytes = enc.encode(name), data = enc.encode(text), c = crc(data);
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)];
    parts.push(Uint8Array.from(local), nameBytes, data);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
  let at = 0; for (const b of all) { out.set(b, at); at += b.length; }
  return out;
}
