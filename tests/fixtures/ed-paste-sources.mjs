// NOTE-붙여넣기문단사라짐: copies (text/html + text/plain) in the shapes each place puts on the clipboard, as the browser writes
// them (Chromium inlines the computed style of the copied box; Firefox writes the box's class only). Letters are made up.
// expect: the pasted paragraphs' letters, a line break inside a paragraph written "\n". strong/link: letters kept as format.
const CHROME_FONT = 'color: rgb(52, 50, 45); font-family: ui-sans-serif, system-ui, sans-serif; font-size: 16px; font-style: normal; font-weight: 400; letter-spacing: normal; text-align: start; text-indent: 0px; text-transform: none; word-spacing: 0px; -webkit-text-stroke-width: 0px; background-color: rgb(250, 249, 245); text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;';
const SEVEN = ['첫 문단입니다. 회의 결과를 정리했어요.', '둘째 문단: 일정은 다음 주로 미룹니다.', '셋째 문단입니다.', '넷째 문단 — 담당 확인.', '다섯째 문단.', '여섯째 문단, 자료는 따로 보냅니다.', '일곱째 문단으로 끝.'];

export const PASTE_SOURCES = [
  {
    name: 'Claude 답(크롬): 한 칸 안 pre-wrap 글, 문단 7개가 빈 줄로 나뉨',
    html: `<meta charset='utf-8'><span style="${CHROME_FONT} white-space: pre-wrap; display: inline !important; float: none;">${SEVEN.join('\n\n')}</span>`,
    text: SEVEN.join('\n\n'),
    expect: SEVEN,
  },
  {
    name: 'Claude 답(크롬, 새 판 스타일 이름): white-space-collapse: preserve',
    html: `<meta charset='utf-8'><div style="${CHROME_FONT} white-space-collapse: preserve; text-wrap-mode: wrap;">${SEVEN.slice(0, 3).join('\n\n')}</div>`,
    text: SEVEN.slice(0, 3).join('\n\n'),
    expect: SEVEN.slice(0, 3),
  },
  {
    name: 'Claude 답(크롬): 여러 칸에 걸친 pre-wrap 상자, 굵게·링크·한 줄 바꿈 포함',
    html: `<meta charset='utf-8'><div class="whitespace-pre-wrap break-words" style="${CHROME_FONT} white-space: pre-wrap;">결정 사항\n\n<strong>굵게</strong> 쓴 문단\n이어지는 줄\n\n<a href="https://example.com/a">링크</a> 문단</div>`,
    text: '결정 사항\n\n굵게 쓴 문단\n이어지는 줄\n\n링크 문단',
    expect: ['결정 사항', '굵게 쓴 문단\n이어지는 줄', '링크 문단'],
    strong: '굵게', link: '링크',
  },
  {
    name: 'Claude 답(크롬): 문단마다 <p> (지금도 나뉘는 모양)',
    html: `<meta charset='utf-8'><p class="whitespace-normal break-words" style="${CHROME_FONT}">${SEVEN[0]}</p><p class="whitespace-normal break-words" style="${CHROME_FONT}">${SEVEN[1]}</p>`,
    text: `${SEVEN[0]}\n\n${SEVEN[1]}`,
    expect: SEVEN.slice(0, 2),
  },
  {
    name: '파이어폭스: 스타일 없이 class만 있는 pre-wrap 상자(글자본과 줄 수 비교)',
    html: `<div class="whitespace-pre-wrap break-words">${SEVEN.slice(0, 3).join('\n\n')}\n한 줄 더</div>`,
    text: `${SEVEN.slice(0, 3).join('\n\n')}\n한 줄 더`,
    expect: [SEVEN[0], SEVEN[1], `${SEVEN[2]}\n한 줄 더`],
  },
  {
    name: 'ChatGPT 답(크롬): 문단마다 <p data-start>',
    html: `<meta charset='utf-8'><p data-start="0" data-end="19" style="${CHROME_FONT}">${SEVEN[0]}</p><p data-start="21" data-end="40" style="${CHROME_FONT}"><strong data-start="21" data-end="26">${SEVEN[1]}</strong></p>`,
    text: `${SEVEN[0]}\n\n${SEVEN[1]}`,
    expect: SEVEN.slice(0, 2),
    strong: SEVEN[1],
  },
  {
    name: 'ChatGPT 내 질문 상자(크롬): pre-wrap 한 칸',
    html: `<meta charset='utf-8'><div class="whitespace-pre-wrap" style="${CHROME_FONT} white-space: pre-wrap;">질문 첫 줄\n둘째 줄\n\n다음 문단</div>`,
    text: '질문 첫 줄\n둘째 줄\n\n다음 문단',
    expect: ['질문 첫 줄\n둘째 줄', '다음 문단'],
  },
  {
    name: 'Google 문서: <b id=docs-internal-guid> 안 문단마다 <p>, 빈 줄은 <br>',
    html: `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c4d-7fff-1234-5678-9abcdef01234"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">${SEVEN[0]}</span></p><br><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:700;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">${SEVEN[1]}</span></p></b>`,
    text: `${SEVEN[0]}\n\n${SEVEN[1]}`,
    // The <br> between paragraphs is Google's own empty line (as before this fix).
    expect: [SEVEN[0], '', SEVEN[1]],
    strong: SEVEN[1], keepEmpty: true,
  },
  {
    name: '한글(HWP): 문단마다 <P CLASS=HStyle0>, 사이 줄바꿈은 원본 모양뿐',
    html: `<HTML>\r\n<HEAD>\r\n<META NAME="Generator" CONTENT="Hancom HWP 12.0.0.1">\r\n</HEAD>\r\n<BODY>\r\n<!--StartFragment-->\r\n<P CLASS=HStyle0 STYLE="margin-left:0.0pt;text-align:justify;line-height:160%;"><SPAN STYLE='font-family:"함초롬바탕";font-size:10.0pt;'>${SEVEN[0]}</SPAN></P>\r\n\r\n<P CLASS=HStyle0>&nbsp;</P>\r\n\r\n<P CLASS=HStyle0 STYLE="margin-left:0.0pt;"><SPAN STYLE='font-family:"함초롬바탕";'>${SEVEN[1]}</SPAN></P>\r\n<!--EndFragment-->\r\n</BODY>\r\n</HTML>`,
    text: `${SEVEN[0]}\r\n\r\n${SEVEN[1]}`,
    // The &nbsp; paragraph is 한글's own empty line (as before this fix).
    expect: [SEVEN[0], '\u00a0', SEVEN[1]],
    keepEmpty: true,
  },
  {
    name: '메일·웹 글: 한 <p> 안 <br><br>로 나뉜 문단',
    html: `<meta charset='utf-8'><p style="${CHROME_FONT}">${SEVEN[0]}<br><br>${SEVEN[1]}<br>이어지는 줄</p>`,
    text: `${SEVEN[0]}\n\n${SEVEN[1]}\n이어지는 줄`,
    expect: [SEVEN[0], `${SEVEN[1]}\n이어지는 줄`],
  },
  {
    name: '원본 모양 줄바꿈만 있는 깔끔한 HTML(글자본도 한 줄): 그대로',
    html: '<p>\n  첫 줄\n  이어짐\n</p>\n<p>둘째</p>',
    text: '첫 줄 이어짐\n\n둘째',
    expect: ['첫 줄 이어짐', '둘째'],
  },
  {
    name: '카카오톡·텔레그램 데스크톱: 글자본만(서식본 없음)',
    html: '',
    text: '첫 문단\n\n둘째 문단\n이어지는 줄',
    expect: ['첫 문단', '', '둘째 문단', '이어지는 줄'],
    keepEmpty: true,
  },
];
