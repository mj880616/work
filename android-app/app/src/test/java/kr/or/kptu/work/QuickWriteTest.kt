package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException

/** APP-위젯빠른쓰기: '새 글 넣기' 세 가지만, 본인 작업공간만, 실패하면 글을 잃지 않게(설계 13절). */
class QuickWriteTest {
    private val user = "11111111-2222-4333-8444-555555555555"
    private val ws = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    private val base = "https://xmlkxfjeagycwttklxjw.supabase.co"

    private class MemoryVault : WidgetVault {
        var value: String? = null
        override fun exists() = value != null
        override fun read() = value
        override fun write(value: String) { this.value = value }
        override fun clear() { value = null }
    }

    private class FakeHttp : WidgetHttp {
        val sent = ArrayList<WidgetRequest>()
        val answers = ArrayDeque<(WidgetRequest) -> WidgetResponse>()
        override fun send(request: WidgetRequest): WidgetResponse {
            sent.add(request)
            val a = answers.removeFirstOrNull() ?: throw AssertionError("unexpected " + request.method + " " + request.url)
            return a(request)
        }
    }

    private val vault = MemoryVault()
    private val http = FakeHttp()
    private val session = WidgetSession(http, vault) { 1_000_000_000_000L }

    private fun reply(code: Int, body: String) = { _: WidgetRequest -> WidgetResponse(code, body) }

    private fun signIn() {
        http.answers.add(reply(200, """{"session":{"access_token":"a1","refresh_token":"r1","expires_in":3600,"user":{"id":"$user"}}}"""))
        assertTrue(session.consume("abcDEF0123456789_-abcDEF0123456789") is WidgetSession.Outcome.Ok)
        http.sent.clear()
    }

    @Test
    fun onlyThreeNewWritesAreAllowed() {
        assertTrue(WidgetRules.allowed("POST", "$base/rest/v1/app_notes"))
        assertTrue(WidgetRules.allowed("POST", "$base/functions/v1/google-tasks?action=create"))
        assertTrue(WidgetRules.allowed("GET", "$base/rest/v1/app_workspace_members?user_id=eq.$user&select=workspace_id&limit=1"))
        // 지우기·고치기·필터 붙인 일괄 요청·다른 표·다른 action은 없다.
        for (m in listOf("PATCH", "DELETE", "PUT")) assertFalse(m, WidgetRules.allowed(m, "$base/rest/v1/app_notes"))
        assertFalse(WidgetRules.allowed("POST", "$base/rest/v1/app_notes?id=eq.x"))
        assertFalse(WidgetRules.allowed("POST", "$base/rest/v1/app_notes?on_conflict=id"))
        assertFalse(WidgetRules.allowed("POST", "$base/rest/v1/app_pages"))
        assertFalse(WidgetRules.allowed("POST", "$base/rest/v1/app_record_links"))
        for (a in listOf("update", "toggle", "delete", "link", "unlink", "attach", "detach")) {
            assertFalse(a, WidgetRules.allowed("POST", "$base/functions/v1/google-tasks?action=$a"))
        }
        assertFalse(WidgetRules.allowed("GET", "$base/rest/v1/app_workspace_members?user_id=eq.$user&select=*&limit=1"))
        assertFalse(WidgetRules.allowed("GET", "$base/rest/v1/app_workspace_members?user_id=eq.x&select=workspace_id&limit=1"))
        assertFalse(WidgetRules.allowed("POST", "$base/rest/v1/app_workspace_members?user_id=eq.$user&select=workspace_id&limit=1"))
    }

    @Test
    fun requestBodiesHoldOnlyTheirFields() {
        val up = QuickWriteRules.request(WidgetAction.UPDATE, "회의 \"결과\"\n둘째 줄", ws)
        assertEquals("$base/rest/v1/app_notes", up.url)
        assertEquals("{\"workspace_id\":\"$ws\",\"raw_text\":\"회의 \\\"결과\\\"\\u000a둘째 줄\"}", up.body)
        assertEquals("return=minimal", up.prefer)
        val note = QuickWriteRules.request(WidgetAction.NOTE, "  제목 줄  \n본문", ws)
        assertEquals("{\"workspace_id\":\"$ws\",\"kind\":\"note\",\"title\":\"제목 줄\",\"raw_text\":\"  제목 줄  \\u000a본문\"}", note.body)
        val task = QuickWriteRules.request(WidgetAction.TASK, "자료 보내기\n담당 확인", ws)
        assertEquals("$base/functions/v1/google-tasks?action=create", task.url)
        assertEquals("{\"action\":\"create\",\"title\":\"자료 보내기\",\"notes\":\"담당 확인\",\"due\":null}", task.body)
        assertEquals(null, task.prefer)
        // 빈 글·너무 긴 글은 보내지 않는다.
        assertTrue(QuickWriteRules.check(WidgetAction.UPDATE, "  \n ") is QuickWriteRules.Check.Bad)
        assertTrue(QuickWriteRules.check(WidgetAction.UPDATE, "가".repeat(20001)) is QuickWriteRules.Check.Bad)
        assertEquals(QuickWriteRules.Check.Ok, QuickWriteRules.check(WidgetAction.UPDATE, "가".repeat(20000)))
        assertTrue(QuickWriteRules.check(WidgetAction.PHOTO, "x") is QuickWriteRules.Check.Bad)
        // 노트 제목은 200자까지.
        val long = QuickWriteRules.request(WidgetAction.NOTE, "가".repeat(300), ws)
        assertTrue(long.body.contains("\"title\":\"" + "가".repeat(200) + "\""))
    }

    @Test
    fun updateReadsOwnWorkspaceOnceThenPosts() {
        signIn()
        http.answers.add(reply(200, """[{"workspace_id":"$ws"}]"""))
        http.answers.add(reply(201, ""))
        assertEquals(WidgetSession.Write.Saved, session.write(WidgetAction.UPDATE, "정리함에 넣을 글"))
        assertEquals("GET $base/rest/v1/app_workspace_members?user_id=eq.$user&select=workspace_id&limit=1", http.sent[0].method + " " + http.sent[0].url)
        val post = http.sent[1]
        assertEquals("POST", post.method)
        assertEquals("$base/rest/v1/app_notes", post.url)
        assertEquals("Bearer a1", post.headers["Authorization"])
        assertEquals("return=minimal", post.headers["Prefer"])
        assertEquals("application/json", post.headers["Content-Type"])
        // 작업공간은 메모리에 두고 다음에는 바로 보낸다.
        http.answers.add(reply(201, ""))
        assertEquals(WidgetSession.Write.Saved, session.write(WidgetAction.NOTE, "노트 제목\n본문"))
        assertEquals(3, http.sent.size)
        assertTrue(http.sent.all { WidgetRules.allowed(it.method, it.url) })
    }

    @Test
    fun taskNeedsOkTrueAndReportsConnection() {
        signIn()
        http.answers.add(reply(200, """[{"workspace_id":"$ws"}]"""))
        http.answers.add(reply(200, """{"ok":true,"task":{"id":"t1"}}"""))
        assertEquals(WidgetSession.Write.Saved, session.write(WidgetAction.TASK, "할 일"))
        http.answers.add(reply(500, """{"error":"Google 할 일이 연결되지 않았습니다."}"""))
        assertEquals(WidgetSession.Write.Failed("할 일 연결이 필요해요 · [크게 열기]"), session.write(WidgetAction.TASK, "할 일"))
    }

    @Test
    fun failuresKeepTextAndSignedOutHandsOver() {
        // 로그인 없으면 아무것도 보내지 않는다(창은 웹2 쓰기 창으로 넘김).
        assertEquals(WidgetSession.Write.SignedOut, session.write(WidgetAction.UPDATE, "글"))
        assertTrue(http.sent.isEmpty())
        signIn()
        // 다른 작업공간 id 모양이 아니면 보내지 않는다.
        http.answers.add(reply(200, "[]"))
        assertEquals(WidgetSession.Write.Failed(QuickWriteRules.NO_WORKSPACE), session.write(WidgetAction.UPDATE, "글"))
        http.answers.add(reply(200, """[{"workspace_id":"$ws"}]"""))
        http.answers.add { throw IOException("down") }
        assertEquals(WidgetSession.Write.Failed(QuickWriteRules.NETWORK), session.write(WidgetAction.UPDATE, "글"))
        http.answers.add(reply(503, "{}"))
        assertEquals(WidgetSession.Write.Failed("서버가 잠시 답하지 않아요 · 다시 저장"), session.write(WidgetAction.UPDATE, "글"))
        // 401이면 접근 토큰을 새로 받아 한 번 더.
        http.answers.add(reply(401, "{}"))
        http.answers.add(reply(200, """{"access_token":"a2","refresh_token":"r2","expires_in":3600,"user":{"id":"$user"}}"""))
        http.answers.add(reply(201, ""))
        assertEquals(WidgetSession.Write.Saved, session.write(WidgetAction.UPDATE, "글"))
        assertEquals("Bearer a2", http.sent.last().headers["Authorization"])
        // 빈 글은 서버에 보내지 않는다.
        val before = http.sent.size
        assertEquals(WidgetSession.Write.Failed("내용을 입력해 주세요"), session.write(WidgetAction.NOTE, "   "))
        assertEquals(before, http.sent.size)
    }

    @Test
    fun quickWindowLogsNoTextAndIsNotExported() {
        val text = File("src/main/java/kr/or/kptu/work/QuickWrite.kt").readText()
        // 기기 로그는 종류·밀리초·결과만(글·토큰 없음).
        Regex("Log\\.[a-z]\\(TAG, ([^\\n]*)\\)").findAll(text).forEach { m ->
            assertFalse(m.value, m.groupValues[1].contains("text") || m.groupValues[1].contains("token") || m.groupValues[1].contains("body"))
        }
        assertFalse(text.contains("getSharedPreferences") || text.contains("openFileOutput") || text.contains("localStorage"))
    }
}
