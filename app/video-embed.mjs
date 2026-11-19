// NOTE-유튜브보기: 글 속 유튜브 링크 아래 작은 영상 칸(16:9). 노트·업데이트·일기 읽기 화면이 쓰는 두 그리기(ed-render.mjs의 doc,
// markdown-view.js의 마크다운)가 이 한 곳을 부른다. 편집기(ed-editor.js)는 부르지 않는다(편집 중에는 링크만).
// 안전 원칙
//   - 링크 주소에서 영상 ID(11자 A-Z a-z 0-9 _ -)와 시작 초만 꺼내고, 재생 주소는 그 값으로 새로 만든다. 글쓴이가 넣은 주소를
//     iframe src에 그대로 넣지 않는다. 허용 주소: youtube.com·www.·m.(watch?v=·shorts/·embed/·live/)·youtu.be/<ID>, http(s)·기본 포트만.
//   - 재생 칸은 youtube-nocookie.com/embed/<ID>만. sandbox(allow-scripts allow-same-origin allow-presentation),
//     allow="fullscreen; picture-in-picture; encrypted-media", referrerpolicy strict-origin-when-cross-origin(유튜브 퍼가기는
//     보낸 곳 주소가 없으면 재생을 거절한다 — 주소 전체가 아니라 사이트 이름만 간다).
//   - ▶를 누르기 전에는 작은 그림(i.ytimg.com/vi/<ID>/mqdefault.jpg) 하나만, 화면에 가까워질 때(lazy) 보낸 곳 없이 부른다.
//     유튜브 쪽 스크립트·쿠키는 ▶를 누른 뒤에만 생긴다.
// 공유 페이지(Web1 읽기 화면)가 ed-render.mjs를 거쳐 이 파일을 읽으므로 옛 삼성 인터넷 문법만 쓴다(?. ?? replaceChildren 없음).

var ID = /^[A-Za-z0-9_-]{11}$/;
var HOSTS = {'youtube.com': 1, 'www.youtube.com': 1, 'm.youtube.com': 1};
var PATH_ID = /^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})\/?$/;
var SHORT_ID = /^\/([A-Za-z0-9_-]{11})\/?$/;
var MAX_START = 86400 * 2;

// "90" · "90s" · "1m30s" · "1h2m3s" → 초. 이상하면 0.
export function startSeconds(value) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return 0;
  var n = 0;
  if (/^\d+s?$/.test(text)) n = parseInt(text, 10);
  else {
    var m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
    if (!m || !(m[1] || m[2] || m[3])) return 0;
    n = (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + parseInt(m[3] || '0', 10);
  }
  return n > 0 && n <= MAX_START ? n : 0;
}

// 링크 주소 → {id, start} 또는 null.
export function youtubeVideo(href) {
  if (typeof href !== 'string' || href.length > 2048) return null;
  var url;
  try { url = new URL(href.trim()); } catch (e) { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  var host = url.hostname.toLowerCase(), id = '', m;
  if (host === 'youtu.be') { m = SHORT_ID.exec(url.pathname); id = m ? m[1] : ''; }
  else if (HOSTS[host] === 1) {
    if (url.pathname === '/watch' || url.pathname === '/watch/') id = url.searchParams.get('v') || '';
    else { m = PATH_ID.exec(url.pathname); id = m ? m[1] : ''; }
  }
  if (!ID.test(id)) return null;
  return {id: id, start: startSeconds(url.searchParams.get('t') || url.searchParams.get('start'))};
}

export function embedUrl(video) {
  if (!video || !ID.test(video.id)) return '';
  var start = startSeconds(video.start);
  return 'https://www.youtube-nocookie.com/embed/' + video.id + '?autoplay=1&playsinline=1&rel=0' + (start ? '&start=' + start : '');
}
export function thumbUrl(video) {
  return video && ID.test(video.id) ? 'https://i.ytimg.com/vi/' + video.id + '/mqdefault.jpg' : '';
}

function make(tag, className) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// ▶를 누르면 그 자리에 재생 칸을 만든다(한 번만).
function play(box, video) {
  if (box.getAttribute('data-ed-video-on') === '1') return;
  var src = embedUrl(video);
  if (!src) return;
  var frame = make('iframe', 'ed-video-frame');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  frame.setAttribute('allow', 'fullscreen; picture-in-picture; encrypted-media');
  frame.setAttribute('allowfullscreen', '');
  frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  frame.setAttribute('title', '유튜브 영상');
  frame.src = src;
  while (box.firstChild) box.removeChild(box.firstChild);
  box.appendChild(frame);
  box.setAttribute('data-ed-video-on', '1');
}

// 영상 칸 하나: 작은 그림 + ▶ 단추(누르면 재생). 링크 글자는 그대로 두고 그 아래에 붙인다.
export function videoBox(video) {
  var box = make('div', 'ed-video');
  box.setAttribute('data-ed-video', video.id);
  var button = make('button', 'ed-video-play');
  button.type = 'button';
  button.setAttribute('aria-label', '유튜브 영상 재생');
  var img = make('img', 'ed-video-thumb');
  img.alt = '';
  img.setAttribute('loading', 'lazy');
  img.setAttribute('decoding', 'async');
  img.setAttribute('referrerpolicy', 'no-referrer');
  img.addEventListener('error', function () { if (img.parentNode) img.parentNode.removeChild(img); });
  img.src = thumbUrl(video);
  var mark = make('span', 'ed-video-mark');
  // ▶는 CSS(::before)로만 그린다 — 본문 글자(밑줄 자리 찾기·복사)에 섞이지 않게.
  mark.setAttribute('aria-hidden', 'true');
  button.appendChild(img);
  button.appendChild(mark);
  button.addEventListener('click', function (event) { event.preventDefault(); play(box, video); });
  box.appendChild(button);
  return box;
}

var BLOCK_TAGS = {P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, LI: 1, TD: 1, TH: 1};
// 글자로만 쓴 주소(링크 표시 없이 붙여 넣은 것)도 찾는다. 후보만 고르고, 판정은 youtubeVideo가 한다.
var BARE = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^\s<>"'()\[\]{}]+/gi;
var MAX_BOXES = 20;

// 링크·글자를 맡는 가장 가까운 문단(중첩 목록은 안쪽 줄이 맡는다). 코드 상자 안·영상 칸 안이면 null.
// whole: 문단 없이 상자 하나로 그린 글(있는 그대로 보기)은 그 상자가 맡는다.
function ownerOf(node, root, whole) {
  for (var at = node.parentNode; at && at.nodeType === 1; at = at.parentNode) {
    if (at.tagName === 'PRE' || at.tagName === 'CODE' || /(^|\s)ed-video(\s|$)/.test(at.className || '')) return null;
    if (at === root) return whole ? root : null;
    if (!whole && BLOCK_TAGS[at.tagName] === 1) return at;
  }
  return null;
}

// 읽기 상자 안 유튜브 주소 → [{owner, video}] (문서 순서, 같은 문단의 같은 영상은 한 번).
function findVideos(root, whole) {
  var found = [], seen = [];
  function add(owner, href) {
    var video = owner ? youtubeVideo(href) : null;
    if (!video) return;
    var key = video.id + ':' + video.start;
    for (var k = 0; k < seen.length; k++) if (seen[k].owner === owner && seen[k].key === key) return;
    seen.push({owner: owner, key: key});
    found.push({owner: owner, video: video});
  }
  var walker = document.createTreeWalker(root, 5 /* SHOW_ELEMENT | SHOW_TEXT */), node;
  while ((node = walker.nextNode()) && found.length < MAX_BOXES) {
    if (node.nodeType === 1) {
      if (node.tagName === 'A' && node.getAttribute('href')) add(ownerOf(node, root, whole), node.getAttribute('href'));
      continue;
    }
    var text = node.nodeValue || '';
    if (text.indexOf('youtu') < 0) continue;
    // 링크 안 글자는 링크가 맡는다.
    var inLink = false;
    for (var up = node.parentNode; up && up !== root; up = up.parentNode) if (up.tagName === 'A') { inLink = true; break; }
    if (inLink) continue;
    var owner = ownerOf(node, root, whole), m;
    BARE.lastIndex = 0;
    while ((m = BARE.exec(text))) add(owner, m[0].replace(/[.,!?;:]+$/, ''));
  }
  return found;
}

// 그려진 읽기 상자 안 유튜브 링크(또는 글자로 쓴 주소)마다 그 문단 바로 뒤에 영상 칸을 붙인다. 목록 줄·표 칸은 그 안 끝에.
// options.whole: 있는 그대로 보기(문단 없는 글 상자) — 칸들을 상자 맨 끝에 붙인다. 한 상자에 최대 20개. 다시 불러도 겹치지 않는다.
export function addVideoBoxes(root, options) {
  if (!root || !root.querySelectorAll || root.querySelector('.ed-video')) return 0;
  var whole = !!(options && options.whole === true), list = findVideos(root, whole), last = {};
  for (var i = 0; i < list.length; i++) {
    var owner = list[i].owner, box = videoBox(list[i].video);
    var inside = owner === root || owner.tagName === 'LI' || owner.tagName === 'TD' || owner.tagName === 'TH';
    if (inside) owner.appendChild(box);
    else {
      // 같은 문단에 칸이 여럿이면 차례대로 그 뒤에 잇는다.
      var prev = null;
      for (var k in last) if (last[k].owner === owner) prev = last[k].box;
      owner.parentNode.insertBefore(box, (prev || owner).nextSibling);
      last[i] = {owner: owner, box: box};
    }
  }
  return list.length;
}
