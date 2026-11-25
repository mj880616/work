// BLOG ①(docs/design/blog.md 4절): share-page-read의 블로그 길. 로그인 없이 명진 블로그(bokdoong.com)의 게시판 목록·글 목록·글 본문만 읽는다.
// - 블로그 작업공간은 요청이 정하지 않는다. 매번 서버가 app_operator_feature_workspace('blog')(허용된 작업공간이 정확히 하나일 때만)로 정한다.
//   요청에는 작업공간·사람을 고르는 칸이 없어서, 다른 가입자가 어떤 값을 보내도 그 사람 표는 읽히지 않는다.
// - 글은 게시 순간의 사본(app_share_pages.blocks, 결정 C '[다시 게시]')만 보인다. 노트 표는 '휴지통·완전히 지움' 확인에만 읽는다(글은 읽지 않음).
// - 모든 '없음'(블로그 꺼짐·blog 허용 없음·틀린 key·내린 글·노트 휴지통·모양 틀림)은 같은 404 한 모양. 응답에 내부 id·작업공간·노트·사람 정보를 넣지 않는다.
// - 사진은 그 글 페이지 소속으로 기록된 사진(app_share_page_media)만 짧게 서명한다(링크 길과 같은 코드).

export type BlogRow = { id: string; workspace_id: string; title: string; intro: string | null; enabled: boolean; indexable: boolean };
export type BlogBoardRow = { id: string; blog_id: string; name: string; sort: number; public_key: string };
export type BlogPostRow = {
  board_id: string;
  page_id: string;
  note_id: string | null;
  public_key: string;
  published_at: string;
  republished_at: string | null;
};
export type BlogPageRow = { id: string; title: string; blocks: unknown; status: string };
export type BlogNoteRow = { id: string; deleted_at: string | null };
// 서버 키로 읽는 범위. 각 질의는 앞 질의가 돌려준 id로만 좁힌다(블로그 → 게시판 → 글 → 페이지·노트).
export type BlogReader = {
  workspace(): Promise<string | null>;
  blogByWorkspace(workspaceId: string): Promise<BlogRow | null>;
  boardsForBlog(blogId: string): Promise<BlogBoardRow[]>;
  postsForBoards(boardIds: string[]): Promise<BlogPostRow[]>;
  postByKey(key: string): Promise<BlogPostRow | null>;
  pagesByIds(ids: string[]): Promise<BlogPageRow[]>;
  notesByIds(ids: string[]): Promise<BlogNoteRow[]>;
  mediaForPage?(pageId: string, ids: string[]): Promise<{ id: string; storage_path: string }[]>;
  signMedia?(path: string, seconds: number): Promise<string | null>;
};

export const BLOG_KEY = /^[0-9a-f]{10}$/;
export const BLOG_PAGE_SIZE = 30;
export const BLOG_MAX_PAGE = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type BlogRequest =
  | { kind: "home" }
  | { kind: "board"; board: string; page: number }
  | { kind: "post"; post: string };

// 받는 모양: {blog:"home"} · {blog:"board", board:"<key>", page?:정수} · {blog:"post", post:"<key>"}. 그 밖은 null(→ 같은 404).
export function parseBlogRequest(o: Record<string, unknown>): BlogRequest | null {
  const keys = Object.keys(o).sort().join(",");
  if (o.blog === "home" && keys === "blog") return { kind: "home" };
  if (o.blog === "board" && (keys === "blog,board" || keys === "blog,board,page")) {
    if (typeof o.board !== "string" || !BLOG_KEY.test(o.board)) return null;
    const page = Object.hasOwn(o, "page") ? o.page : 0;
    if (typeof page !== "number" || !Number.isInteger(page) || page < 0 || page > BLOG_MAX_PAGE) return null;
    return { kind: "board", board: o.board, page };
  }
  if (o.blog === "post" && keys === "blog,post") {
    if (typeof o.post !== "string" || !BLOG_KEY.test(o.post)) return null;
    return { kind: "post", post: o.post };
  }
  return null;
}

// 게시일은 서울 날짜(YYYY-MM-DD).
export function seoulDate(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const clip = (s: unknown, n: number) => typeof s === "string" ? [...s.trim()].slice(0, n).join("") : "";

export type BlogResult = { status: 200; body: Record<string, unknown> } | { status: 404 };
const NONE: BlogResult = { status: 404 };

export async function readBlog(
  reader: BlogReader,
  req: BlogRequest,
  photos: { ids(blocks: unknown[]): string[]; seconds: number; log(code: string): void },
): Promise<BlogResult> {
  const ws = await reader.workspace();
  if (typeof ws !== "string" || !UUID.test(ws)) return NONE;
  const blog = await reader.blogByWorkspace(ws);
  if (!blog || blog.workspace_id !== ws || blog.enabled !== true || typeof blog.id !== "string") return NONE;
  const boards = (await reader.boardsForBlog(blog.id))
    .filter((b) => b && b.blog_id === blog.id && typeof b.public_key === "string" && BLOG_KEY.test(b.public_key))
    .sort((a, b) => (a.sort - b.sort) || String(a.name).localeCompare(String(b.name)));
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const head = { title: clip(blog.title, 60), indexable: blog.indexable === true };

  // 보이는 글: 이 블로그 게시판 소속 + 페이지 게시됨(내림·휴지통이면 draft·archived) + 짝 노트가 있고 휴지통 아님.
  const visible = async (posts: BlogPostRow[]) => {
    const own = posts.filter((p) => p && boardById.has(p.board_id) && typeof p.page_id === "string" && UUID.test(p.page_id)
      && typeof p.note_id === "string" && UUID.test(p.note_id) && typeof p.public_key === "string" && BLOG_KEY.test(p.public_key));
    if (!own.length) return [] as { post: BlogPostRow; page: BlogPageRow }[];
    const pages = new Map((await reader.pagesByIds([...new Set(own.map((p) => p.page_id))])).map((p) => [p.id, p]));
    const notes = new Map((await reader.notesByIds([...new Set(own.map((p) => p.note_id!))])).map((n) => [n.id, n]));
    const out: { post: BlogPostRow; page: BlogPageRow }[] = [];
    for (const post of own) {
      const page = pages.get(post.page_id), note = notes.get(post.note_id!);
      if (!page || page.id !== post.page_id || page.status !== "published" || typeof page.title !== "string" || !Array.isArray(page.blocks)) continue;
      if (!note || note.id !== post.note_id || note.deleted_at !== null) continue;
      out.push({ post, page });
    }
    return out.sort((a, b) => Date.parse(b.post.published_at) - Date.parse(a.post.published_at));
  };

  if (req.kind === "home") {
    const shown = boards.length ? await visible(await reader.postsForBoards(boards.map((b) => b.id))) : [];
    const count = new Map<string, number>();
    for (const { post } of shown) count.set(post.board_id, (count.get(post.board_id) ?? 0) + 1);
    return { status: 200, body: { ok: true, blog: { ...head, intro: blog.intro ? clip(blog.intro, 120) : null },
      boards: boards.map((b) => ({ key: b.public_key, name: clip(b.name, 40), count: count.get(b.id) ?? 0 })) } };
  }
  if (req.kind === "board") {
    const board = boards.find((b) => b.public_key === req.board);
    if (!board) return NONE;
    const shown = (await visible(await reader.postsForBoards([board.id]))).filter(({ post }) => post.board_id === board.id);
    const start = req.page * BLOG_PAGE_SIZE;
    return { status: 200, body: { ok: true, blog: head, board: { key: board.public_key, name: clip(board.name, 40) },
      posts: shown.slice(start, start + BLOG_PAGE_SIZE).map(({ post, page }) => ({ key: post.public_key, title: clip(page.title, 200), date: seoulDate(post.published_at) })),
      more: shown.length > start + BLOG_PAGE_SIZE } };
  }
  const found = await reader.postByKey(req.post);
  if (!found || found.public_key !== req.post) return NONE;
  const [one] = await visible([found]);
  if (!one) return NONE;
  const board = boardById.get(one.post.board_id)!;
  const blocks = one.page.blocks as unknown[];
  const media: Record<string, string> = {};
  const ids = reader.mediaForPage && reader.signMedia ? photos.ids(blocks) : [];
  if (ids.length) {
    try {
      for (const row of await reader.mediaForPage!(one.page.id, ids)) {
        if (!ids.includes(row.id)) continue;
        const url = await reader.signMedia!(row.storage_path, photos.seconds);
        if (url) media[row.id] = url;
      }
    } catch { photos.log("blog_media_unavailable"); for (const k of Object.keys(media)) delete media[k]; }
  }
  return { status: 200, body: { ok: true, blog: head, board: { key: board.public_key, name: clip(board.name, 40) },
    post: { key: one.post.public_key, title: clip(one.page.title, 200), date: seoulDate(one.post.published_at),
      updated: seoulDate(one.post.republished_at), blocks },
    ...(ids.length ? { media } : {}) } };
}
