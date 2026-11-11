package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

/**
 * APP-뒤에서올리기 1단계(설계 docs/design/phone-widget-auth.md 16절): 웹 화면이 넘긴 사진·파일을 앱이 뒤에서 올린다.
 * 서버 입구는 library-files 하나·정해진 multipart 모양뿐, 임시 파일은 끝낸 뒤 지움, 같은 파일을 겹쳐 올리지 않음.
 * 시험 자료는 모두 지어낸 값이다.
 */
class BackUploadTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val user = "11111111-2222-4333-8444-555555555555"
    private val meeting = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    private val project = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    private val doc1 = "cccccccc-0000-4ccc-8ddd-000000000001"
    private val doc2 = "cccccccc-0000-4ccc-8ddd-000000000002"
    private val doc3 = "cccccccc-0000-4ccc-8ddd-000000000003"
    private val base = "https://xmlkxfjeagycwttklxjw.supabase.co"
    private val url = "$base/functions/v1/library-files"

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
    private var clock = 1_000_000_000_000L
    private val session = WidgetSession(http, vault) { clock }
    private val target = BackUploadRules.Target("meeting", meeting, null)

    private fun reply(code: Int, body: String) = { _: WidgetRequest -> WidgetResponse(code, body) }

    private fun ok(id: String) = reply(200, """{"ok":true,"document":{"id":"$id"},"auto":{}}""")

    private fun signIn() {
        http.answers.add(reply(200, """{"session":{"access_token":"a1","refresh_token":"r1","expires_in":3600,"user":{"id":"$user"}}}"""))
        assertTrue(session.consume("abcDEF0123456789_-abcDEF0123456789") is WidgetSession.Outcome.Ok)
        http.sent.clear()
    }

    private fun file(): File = tmp.newFile().apply { writeBytes(byteArrayOf(1, 2, 3)) }

    private fun store(): BackUploadStore = BackUploadStore(File(tmp.root, "back-upload").apply { mkdirs() }) { clock }

    private fun begin(name: String, mime: String, size: Int, extra: String = "") =
        BackUploadRules.message("""up:begin:{"name":"$name","mime":"$mime","size":$size$extra}""") as BackUploadRules.Message.Begin

    /** 묶음 하나를 받아 닫는다(다리가 하는 일과 같은 순서). 파일마다 3바이트. */
    private fun sealed(store: BackUploadStore, vararg files: Pair<String, String>, t: BackUploadRules.Target = target): String {
        val batch = store.create()
        val intake = BackUploadRules.Intake(batch, t, files.size)
        for ((name, mime) in files) {
            val e = intake.begin(begin(name, mime, 3))!!
            store.begin(batch, e.index)
            assertTrue(intake.part(3))
            store.part(batch, e.index, byteArrayOf(7, 8, 9))
            val size = intake.currentSize
            assertNotNull(intake.end())
            assertTrue(store.end(batch, e.index, size))
        }
        assertTrue(intake.ready)
        store.seal(batch, intake.target, intake.entries)
        return batch
    }

    // ── 허용 요청 ──

    @Test
    fun onlyTheExactLibraryUploadAddressIsAdded() {
        assertTrue(WidgetRules.allowed("POST", url))
        assertEquals(url, WidgetRules.LIBRARY_FILES)
        assertFalse(WidgetRules.allowed("GET", url))
        assertFalse(WidgetRules.allowed("DELETE", url))
        for (tail in listOf("?action=previous-keep", "?mode=record_line", "/", "?")) assertFalse(tail, WidgetRules.allowed("POST", url + tail))
        // 자료실의 다른 입구는 그대로 막혀 있다.
        for (other in listOf("document-actions", "library-search", "ai-assist", "drive-summary")) assertFalse(other, WidgetRules.allowed("POST", "$base/functions/v1/$other"))
    }

    @Test
    fun multipartShapeIsFixed() {
        val f = file()
        val part = WidgetPart("file", file = f, fileName = "a.jpg", type = "image/jpeg")
        val mid = WidgetPart("meeting_id", value = meeting)
        fun allowed(vararg p: WidgetPart) = WidgetRules.allowedParts("POST", url, null, p.toList())
        assertTrue(allowed(part, mid))
        assertTrue(allowed(part, mid, WidgetPart("project_id", value = project), WidgetPart("title", value = "가짜 제목"), WidgetPart("category", value = "사진"), WidgetPart("document_date", value = "2026-11-11")))
        // 사업 보고 없이·파일 없이·두 번 넣은 칸은 거절.
        assertFalse(allowed(part))
        assertFalse(allowed(mid))
        assertFalse(allowed(part, part, mid))
        assertFalse(allowed(part, mid, mid))
        // 서버의 다른 동작으로 가는 칸은 보내지 않는다.
        for (name in listOf("mode", "replace_document_id", "source", "description", "tags", "action", "organization_id", "note_id", "workspace_id")) {
            assertFalse(name, allowed(part, mid, WidgetPart(name, value = "x")))
        }
        // 값 모양.
        assertFalse(allowed(part, WidgetPart("meeting_id", value = "x")))
        assertFalse(allowed(part, mid, WidgetPart("project_id", value = "x")))
        assertFalse(allowed(part, mid, WidgetPart("document_date", value = "2026-11-11T00:00:00Z")))
        assertFalse(allowed(part, mid, WidgetPart("title", value = "")))
        assertFalse(allowed(part, mid, WidgetPart("title", value = "가".repeat(201))))
        assertFalse(allowed(part, mid, WidgetPart("title", value = "줄\n바꿈")))
        assertFalse(allowed(part, mid, WidgetPart("category", value = "가".repeat(41))))
        assertFalse(allowed(WidgetPart("file", value = "x"), mid))
        assertFalse(allowed(WidgetPart("file", file = f, fileName = ""), mid))
        assertFalse(allowed(part, WidgetPart("meeting_id", file = f, fileName = "b")))
        // 같은 주소의 JSON 본문(action)·GET·본문과 multipart를 함께 보내는 요청은 거절.
        assertFalse(WidgetRules.allowedParts("POST", url, "{}", null))
        assertFalse(WidgetRules.allowedParts("POST", url, null, null))
        assertFalse(WidgetRules.allowedParts("POST", url, "{}", listOf(part, mid)))
        assertFalse(WidgetRules.allowedParts("GET", url, null, listOf(part, mid)))
        // 정리함 올리기 주소에는 이 모양을, 이 주소에는 정리함 모양을 보내지 못한다.
        assertFalse(WidgetRules.allowedParts("POST", WidgetRules.BASKET_FILES, null, listOf(part, mid)))
        assertFalse(WidgetRules.allowedParts("POST", url, null, listOf(part, WidgetPart("note_id", value = meeting))))
        // 다른 주소는 그대로.
        assertTrue(WidgetRules.allowedParts("POST", WidgetRules.NOTES, "{}", null))
        assertFalse(WidgetRules.allowedParts("POST", WidgetRules.NOTES, null, listOf(part, mid)))
    }

    // ── 다리 글 ──

    @Test
    fun bridgeMessagesParse() {
        assertEquals(BackUploadRules.Message.Hello, BackUploadRules.message("up:hello"))
        assertEquals(BackUploadRules.Message.End, BackUploadRules.message("up:end"))
        assertEquals(BackUploadRules.Message.Go, BackUploadRules.message("up:go"))
        assertEquals(BackUploadRules.Message.Cancel, BackUploadRules.message("up:cancel"))
        val start = BackUploadRules.message("""up:start:{"kind":"meeting","meeting":"${meeting.uppercase()}","project":"$project","count":4}""") as BackUploadRules.Message.Start
        assertEquals(BackUploadRules.Target("meeting", meeting, project), start.target)
        assertEquals(4, start.count)
        val noProject = BackUploadRules.message("""up:start:{"kind":"meeting","meeting":"$meeting","project":"","count":1}""") as BackUploadRules.Message.Start
        assertNull(noProject.target.project)
        val b = begin("a.jpg", "IMAGE/JPEG", 10, ""","title":" 가짜 제목 ","category":"사진","date":"2026-11-11"""")
        assertEquals("image/jpeg", b.mime)
        assertEquals(10L, b.size)
        assertEquals(BackUploadRules.Fields("가짜 제목", "사진", "2026-11-11"), b.fields)
        assertEquals(BackUploadRules.Fields(), begin("a.pdf", "application/pdf", 1).fields)
        assertEquals(BackUploadRules.Message.Part("AAAA"), BackUploadRules.message("up:part:AAAA"))
        val seen = "abcdefghijklmnop_-012345"
        assertEquals(BackUploadRules.Message.Seen(seen), BackUploadRules.message("up:seen:$seen"))
    }

    @Test
    fun bridgeRejectsBadMessages() {
        val bad = listOf(
            null, "", "up:", "up:hello:x", "out:hello", "up:retry:x",
            // 대상: 종류·uuid·개수.
            """up:start:{"kind":"library","meeting":"$meeting","count":1}""",
            """up:start:{"kind":"meeting","meeting":"x","count":1}""",
            """up:start:{"kind":"meeting","meeting":"$meeting","project":"x","count":1}""",
            """up:start:{"kind":"meeting","meeting":"$meeting","project":5,"count":1}""",
            """up:start:{"kind":"meeting","meeting":"$meeting","count":0}""",
            """up:start:{"kind":"meeting","meeting":"$meeting","count":21}""",
            """up:start:{"kind":"meeting","meeting":"$meeting","count":1.5}""",
            "up:start:[]", "up:start:{",
            // 파일: 크기·날짜.
            """up:begin:{"name":"a","mime":"image/jpeg","size":0}""",
            """up:begin:{"name":"a","mime":"image/jpeg","size":${BackUploadRules.MAX_BYTES + 1}}""",
            """up:begin:{"name":"a","mime":"image/jpeg","size":3,"date":"11/11"}""",
            """up:begin:{"name":"a","mime":"image/jpeg","size":3,"date":5}""",
            "up:part:", "up:part:AAA", "up:part:AA*A", "up:part:" + "A".repeat(BackUploadRules.PART_MAX + 4),
            "up:seen:short", "up:seen:../../../../etc/passwd",
        )
        for (m in bad) assertNull(m, BackUploadRules.message(m))
        // 긴 이름·제목은 잘라 받고, 제어 글자는 싣지 않는다.
        val long = begin("a", "image/jpeg", 3, ""","title":"${"가".repeat(300)}","category":"줄\n바꿈"""")
        assertEquals(200, long.fields.title!!.length)
        assertEquals("줄 바꿈", long.fields.category)
    }

    @Test
    fun acksCarryOnlyStepErrorAndBatchName() {
        assertEquals("""up:ack:{"ok":true,"step":"start","error":"","id":"abcdefghijklmnop_-012345"}""", BackUploadRules.ackMessage(true, "start", "", "abcdefghijklmnop_-012345"))
        assertEquals("""up:ack:{"ok":false,"step":"begin","error":"space"}""", BackUploadRules.ackMessage(false, "begin", "space"))
        assertEquals("""up:ack:{"ok":false,"step":"bad","error":"bad"}""", BackUploadRules.ackMessage(false, "bad", "bad", "../x"))
        // 걸음·까닭 이름에는 영문 소문자(까닭은 밑줄까지)만 남긴다.
        assertEquals("""up:ack:{"ok":false,"step":"go","error":"failed"}""", BackUploadRules.ackMessage(false, "go<\">", "fa\"<>iled"))
    }

    // ── 받기 ──

    @Test
    fun intakeHoldsCountAndDeclaredSize() {
        val intake = BackUploadRules.Intake("abcdefghijklmnop_-012345", target, 2)
        assertFalse(intake.ready)
        val first = intake.begin(begin("../../a b.jpg", "image/jpeg", 5))!!
        assertEquals(0, first.index)
        assertEquals(".. .. a b.jpg", first.name)
        // 받는 중에 또 시작하지 못한다.
        assertNull(intake.begin(begin("b.jpg", "image/jpeg", 5)))
        assertTrue(intake.part(3))
        // 선언한 크기를 넘는 조각은 거절.
        assertFalse(intake.part(3))
        assertTrue(intake.part(2))
        assertEquals(5L, intake.currentSize)
        assertEquals(first, intake.end())
        // 크기가 모자란 채 끝내면 세지 않는다.
        assertNotNull(intake.begin(begin("b.jpg", "image/jpeg", 5)))
        assertTrue(intake.part(4))
        assertNull(intake.end())
        assertFalse(intake.ready)
        val second = intake.begin(begin("b.jpg", "image/jpeg", 1))!!
        assertEquals(1, second.index)
        assertTrue(intake.part(1))
        assertNotNull(intake.end())
        assertTrue(intake.ready)
        // 선언한 개수를 넘겨 받지 않는다.
        assertNull(intake.begin(begin("c.jpg", "image/jpeg", 1)))
    }

    @Test
    fun storeKeepsFilesTargetAndFieldsUntilUploaded() {
        val s = store()
        val batch = s.create()
        val intake = BackUploadRules.Intake(batch, BackUploadRules.Target("meeting", meeting, project), 2)
        val a = intake.begin(begin("사진 1.jpg", "image/jpeg", 4, ""","title":"사진 1","category":"사진","date":"2026-11-11""""))!!
        s.begin(batch, a.index)
        s.part(batch, a.index, byteArrayOf(1, 2))
        s.part(batch, a.index, byteArrayOf(3, 4))
        intake.part(4)
        intake.end()
        assertTrue(s.end(batch, a.index, 4))
        val b = intake.begin(begin("자료.pdf", "application/pdf", 1))!!
        s.begin(batch, b.index)
        s.part(batch, b.index, byteArrayOf(9))
        intake.part(1)
        intake.end()
        assertTrue(s.end(batch, b.index, 1))
        // 닫기 전에는 올릴 묶음이 아니다.
        assertEquals(0, s.total(batch))
        assertTrue(s.batches().isEmpty())
        assertNull(BackUploadRules.jobJson(s, batch))
        s.seal(batch, intake.target, intake.entries)
        assertEquals(2, s.total(batch))
        assertEquals(listOf(batch), s.batches())
        assertEquals(listOf(batch), s.pending())
        assertEquals(BackUploadRules.Target("meeting", meeting, project), s.target(batch))
        val items = s.items(batch)
        assertEquals(listOf("사진 1.jpg", "자료.pdf"), items.map { it.name })
        assertEquals(listOf("image/jpeg", "application/pdf"), items.map { it.type })
        assertEquals(BackUploadRules.Fields("사진 1", "사진", "2026-11-11"), items[0].fields)
        assertEquals(BackUploadRules.Fields(), items[1].fields)
        assertEquals(listOf<Byte>(1, 2, 3, 4), items[0].file.readBytes().toList())
        assertFalse(s.photosOnly(batch))
        // 크기가 선언과 다르면 받지 않는다.
        val other = s.create()
        s.begin(other, 0)
        s.part(other, 0, byteArrayOf(1))
        assertFalse(s.end(other, 0, 2))
        assertFalse(File(File(tmp.root, "back-upload"), "$other/0.part").exists())
    }

    // ── 한 개 올리기(위젯 세션) ──

    @Test
    fun uploadSendsFileAndTargetWithSessionToken() {
        signIn()
        val f = file()
        http.answers.add(ok(doc1))
        val r = session.uploadLibrary(f, "사진 1.jpg", "image/jpeg", BackUploadRules.Target("meeting", meeting, project), BackUploadRules.Fields("사진 1", "사진", "2026-11-11"))
        assertEquals(BackUploadRules.One.Saved(doc1), r)
        val req = http.sent.single()
        assertEquals("POST", req.method)
        assertEquals(url, req.url)
        assertNull(req.body)
        assertTrue(req.once)
        assertEquals("Bearer a1", req.headers["Authorization"])
        assertEquals(setOf("Authorization", "apikey"), req.headers.keys)
        val parts = req.parts!!
        assertEquals(listOf("file", "meeting_id", "project_id", "title", "category", "document_date"), parts.map { it.name })
        assertEquals(f, parts[0].file)
        assertEquals("사진 1.jpg", parts[0].fileName)
        assertEquals("image/jpeg", parts[0].type)
        assertEquals(listOf(meeting, project, "사진 1", "사진", "2026-11-11"), parts.drop(1).map { it.value })
        // 사진 칸이 없는 자료는 파일과 사업 보고만 보낸다(서버 기본값).
        http.answers.add(ok(doc2))
        assertEquals(BackUploadRules.One.Saved(doc2), session.uploadLibrary(file(), "자료.pdf", "application/pdf", target, BackUploadRules.Fields()))
        assertEquals(listOf("file", "meeting_id"), http.sent.last().parts!!.map { it.name })
    }

    @Test
    fun signedOutSendsNothing() {
        assertEquals(BackUploadRules.One.SignedOut, session.uploadLibrary(file(), "a.jpg", "image/jpeg", target, BackUploadRules.Fields()))
        assertTrue(http.sent.isEmpty())
    }

    @Test
    fun unauthorizedRefreshesOnceThenStops() {
        signIn()
        http.answers.add(reply(401, "{}"))
        http.answers.add(reply(200, """{"access_token":"a2","refresh_token":"r2","expires_in":3600,"user":{"id":"$user"}}"""))
        http.answers.add(ok(doc1))
        assertEquals(BackUploadRules.One.Saved(doc1), session.uploadLibrary(file(), "a.jpg", "image/jpeg", target, BackUploadRules.Fields()))
        assertEquals(listOf(url, WidgetRules.TOKEN, url), http.sent.map { it.url })
        assertEquals("Bearer a2", http.sent[2].headers["Authorization"])
        // 새 토큰으로도 401이면 로그인 풀림으로 멈춘다(남은 파일은 둔다).
        http.sent.clear()
        http.answers.add(reply(401, "{}"))
        http.answers.add(reply(200, """{"access_token":"a3","refresh_token":"r3","expires_in":3600,"user":{"id":"$user"}}"""))
        http.answers.add(reply(401, "{}"))
        assertEquals(BackUploadRules.One.SignedOut, session.uploadLibrary(file(), "a.jpg", "image/jpeg", target, BackUploadRules.Fields()))
    }

    @Test
    fun cutBeforeSentRetriesButCutAfterSentDoesNot() {
        signIn()
        // 보내기 전·보내는 중 끊김: 서버가 다 받지 못했으니 그 파일을 두고 다시.
        http.answers.add { throw IOException("x") }
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.NETWORK, true), session.uploadLibrary(file(), "a.jpg", "image/jpeg", target, BackUploadRules.Fields()))
        // 다 보낸 뒤 답을 못 받음: 자료가 생겼을 수 있어 같은 파일을 저절로 다시 보내지 않는다.
        http.answers.add { throw WidgetSentException() }
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.UNKNOWN, false), session.uploadLibrary(file(), "a.jpg", "image/jpeg", target, BackUploadRules.Fields()))
        // 토큰을 새로 받다가 끊기면 아직 보낸 것이 없으니 다시.
        clock += 2 * 60 * 60 * 1000L
        http.answers.add { throw IOException("x") }
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.NETWORK, true), session.uploadLibrary(file(), "a.jpg", "image/jpeg", target, BackUploadRules.Fields()))
    }

    @Test
    fun serverAnswersMapToOutcome() {
        fun r(status: Int, body: String) = BackUploadRules.result(status, MiniJson.parse(body))
        assertEquals(BackUploadRules.One.Saved(doc1), r(200, """{"ok":true,"document":{"id":"${doc1.uppercase()}"}}"""))
        // 200인데 자료 id가 없으면 결과 모름(겹쳐 올리지 않음).
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.UNKNOWN, false), r(200, """{"ok":true}"""))
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.UNKNOWN, false), r(200, """{"ok":true,"document":{"id":"x"}}"""))
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.TOO_BIG, false), r(413, """{"code":"file_too_large"}"""))
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.GONE, false, whole = true), r(404, """{"code":"meeting_not_found"}"""))
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.FORBIDDEN, false, whole = true), r(403, """{"code":"forbidden"}"""))
        // 서버가 다시 해도 된다고 답한 실패·요청이 닿지 못한 실패만 다시.
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.SERVER, true), r(503, """{"code":"drive_upload_failed","retryable":true}"""))
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.SERVER, true), r(500, """{"code":"document_record_failed","retryable":true}"""))
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.SERVER, true), r(429, "{}"))
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.SERVER, true), r(503, ""))
        // 그 밖의 5xx·시간 초과는 자료가 생겼는지 알 수 없다.
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.UNKNOWN, false), r(500, "{}"))
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.UNKNOWN, false), r(504, ""))
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.UNKNOWN, false), r(408, "{}"))
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.REFUSED, false), r(400, """{"code":"invalid_request","retryable":true}"""))
        assertEquals(BackUploadRules.One.Failed(BackUploadRules.REFUSED, false), r(404, "{}"))
    }

    // ── 묶음 돌리기 ──

    @Test
    fun runUploadsEveryFileAndDeletesTempFiles() {
        val s = store()
        val batch = sealed(s, "a.jpg" to "image/jpeg", "b.jpg" to "image/jpeg", "c.jpg" to "image/jpeg")
        val docs = ArrayDeque(listOf(doc1, doc2, doc3))
        val seen = ArrayList<String>()
        var steps = 0
        val run = BackUploadRules.run(s, batch, after = { steps++ }) { item, t ->
            assertEquals(target, t)
            assertTrue(item.file.isFile)
            seen.add(item.name)
            BackUploadRules.One.Saved(docs.removeFirst())
        }
        assertEquals(BackUploadRules.Run.Done(3, 0, 3, null, true), run)
        assertEquals(listOf("a.jpg", "b.jpg", "c.jpg"), seen)
        assertEquals(3, steps)
        // 임시 파일은 남지 않고 결과 기록만 남는다.
        val dir = File(File(tmp.root, "back-upload"), batch)
        assertEquals(setOf("meta", "job", "done"), dir.list()!!.toSet())
        assertTrue(s.pending().isEmpty())
        assertEquals("사업 보고에 사진 3장을 올렸어요", BackUploadRules.doneText(run as BackUploadRules.Run.Done))
        val job = MiniJson.obj(MiniJson.parse(BackUploadRules.jobJson(s, batch)!!))!!
        assertEquals("done", job["state"])
        assertEquals(meeting, job["target"])
        assertEquals(listOf(doc1, doc2, doc3), job["docs"])
        assertEquals(listOf("", "", ""), job["errors"])
        // 화면이 봤다고 하면 기록도 지운다.
        assertTrue(s.seen(batch))
        assertFalse(s.exists(batch))
    }

    @Test
    fun retryableFailureKeepsTheRestAndResumesWithoutResending() {
        val s = store()
        val batch = sealed(s, "a.jpg" to "image/jpeg", "b.pdf" to "application/pdf", "c.jpg" to "image/jpeg")
        val first = BackUploadRules.run(s, batch) { item, _ ->
            if (item.index == 0) BackUploadRules.One.Saved(doc1) else BackUploadRules.One.Failed(BackUploadRules.NETWORK, true)
        }
        assertEquals(BackUploadRules.Run.Stopped(BackUploadRules.NETWORK, true, 2, 3), first)
        assertEquals(listOf("b.pdf", "c.jpg"), s.items(batch).map { it.name })
        assertEquals(listOf(batch), s.pending())
        // 올리는 중인 묶음은 '봤음'으로 지워지지 않는다.
        assertFalse(s.seen(batch))
        assertEquals("run", MiniJson.obj(MiniJson.parse(BackUploadRules.jobJson(s, batch)!!))!!["state"])
        // 3번 안쪽은 저절로 다시, 그 뒤에는 멈춘 까닭을 적는다.
        val stopped = first as BackUploadRules.Run.Stopped
        assertTrue(BackUploadRules.autoRetry(stopped, 0))
        assertTrue(BackUploadRules.autoRetry(stopped, 1))
        assertFalse(BackUploadRules.autoRetry(stopped, 2))
        s.stop(batch, stopped.reason)
        val job = MiniJson.obj(MiniJson.parse(BackUploadRules.jobJson(s, batch)!!))!!
        assertEquals("stopped", job["state"])
        assertEquals("network", job["reason"])
        assertEquals(listOf(doc1, "", ""), job["docs"])
        // 다시 걸면(up:hello) 이미 올린 파일은 다시 보내지 않는다.
        s.stop(batch, null)
        val sent = ArrayList<String>()
        val again = BackUploadRules.run(s, batch) { item, _ ->
            sent.add(item.name)
            BackUploadRules.One.Saved(if (item.index == 1) doc2 else doc3)
        }
        assertEquals(listOf("b.pdf", "c.jpg"), sent)
        assertEquals(BackUploadRules.Run.Done(3, 0, 3, null, false), again)
        assertEquals("사업 보고에 자료 3개를 올렸어요", BackUploadRules.doneText(again as BackUploadRules.Run.Done))
    }

    @Test
    fun oneBadFileDoesNotBlockTheOthers() {
        val s = store()
        val batch = sealed(s, "a.jpg" to "image/jpeg", "b.jpg" to "image/jpeg", "c.jpg" to "image/jpeg")
        val run = BackUploadRules.run(s, batch) { item, _ ->
            when (item.index) {
                0 -> BackUploadRules.One.Failed(BackUploadRules.TOO_BIG, false)
                1 -> BackUploadRules.One.Failed(BackUploadRules.UNKNOWN, false)
                else -> BackUploadRules.One.Saved(doc3)
            }
        }
        assertEquals(BackUploadRules.Run.Done(1, 2, 3, BackUploadRules.TOO_BIG, true), run)
        // 다시 안 될 실패 파일도 임시 폴더에 남기지 않는다.
        assertTrue(s.items(batch).isEmpty())
        val job = MiniJson.obj(MiniJson.parse(BackUploadRules.jobJson(s, batch)!!))!!
        assertEquals("done", job["state"])
        assertEquals(listOf("", "", doc3), job["docs"])
        assertEquals(listOf("too_big", "unknown", ""), job["errors"])
        assertEquals("사업 보고에 사진 3장 중 2장을 올리지 못했어요 · 파일이 너무 커요(100MB까지)", BackUploadRules.doneText(run as BackUploadRules.Run.Done))
    }

    @Test
    fun targetLevelFailureStopsSendingTheRest() {
        val s = store()
        val batch = sealed(s, "a.jpg" to "image/jpeg", "b.jpg" to "image/jpeg", "c.jpg" to "image/jpeg")
        var calls = 0
        val run = BackUploadRules.run(s, batch) { _, _ ->
            calls++
            BackUploadRules.One.Failed(BackUploadRules.GONE, false, whole = true)
        }
        // 사업 보고가 지워졌으면 남은 파일을 보내 보지 않는다.
        assertEquals(1, calls)
        assertEquals(BackUploadRules.Run.Done(0, 3, 3, BackUploadRules.GONE, true), run)
        assertTrue(s.items(batch).isEmpty())
        assertEquals("사업 보고에 사진 3장을 올리지 못했어요 · 사업 보고를 찾지 못했어요", BackUploadRules.doneText(run as BackUploadRules.Run.Done))
    }

    @Test
    fun signedOutKeepsFilesAndDoesNotAutoRetry() {
        val s = store()
        val batch = sealed(s, "a.jpg" to "image/jpeg", "b.jpg" to "image/jpeg")
        val run = BackUploadRules.run(s, batch) { _, _ -> BackUploadRules.One.SignedOut }
        assertEquals(BackUploadRules.Run.Stopped(BackUploadRules.SIGNED_OUT, false, 2, 2), run)
        assertFalse(BackUploadRules.autoRetry(run as BackUploadRules.Run.Stopped, 0))
        assertEquals(2, s.items(batch).size)
        assertEquals("사업 보고 올리기가 멈췄어요(2개 남음) · 위젯 로그인이 풀렸어요 · 위젯에서 로그인한 뒤 앱을 열면 이어 올려요", BackUploadRules.stoppedText(run))
    }

    @Test
    fun missingTempFileIsReportedNotSkippedSilently() {
        val s = store()
        val batch = sealed(s, "a.jpg" to "image/jpeg", "b.jpg" to "image/jpeg")
        File(File(tmp.root, "back-upload"), "$batch/0").delete()
        val run = BackUploadRules.run(s, batch) { _, _ -> BackUploadRules.One.Saved(doc2) }
        assertEquals(BackUploadRules.Run.Done(1, 1, 2, BackUploadRules.MISSING, true), run)
        assertEquals(listOf(BackUploadStore.Result(0, null, "missing"), BackUploadStore.Result(1, doc2, null)), s.results(batch).sortedBy { it.index })
        // 작업이 돌기 전에 임시 파일이 모두 사라진 묶음도 '끝남 · 사라짐'으로 보인다(까닭이 빈 채로 끝나지 않게).
        val gone = sealed(s, "a.jpg" to "image/jpeg")
        File(File(tmp.root, "back-upload"), "$gone/0").delete()
        val job = MiniJson.obj(MiniJson.parse(BackUploadRules.jobJson(s, gone)!!))!!
        assertEquals("done", job["state"])
        assertEquals(listOf("missing"), job["errors"])
    }

    @Test
    fun failureTextsNameTheRealCause() {
        // 인터넷 문구는 인터넷 탓일 때만 쓴다.
        for (code in listOf(BackUploadRules.SERVER, BackUploadRules.SIGNED_OUT, BackUploadRules.TOO_BIG, BackUploadRules.FORBIDDEN, BackUploadRules.GONE, BackUploadRules.UNKNOWN, BackUploadRules.REFUSED, BackUploadRules.MISSING, BackUploadRules.INTERNAL)) {
            val text = BackUploadRules.stoppedText(BackUploadRules.Run.Stopped(code, true, 1, 2)) + BackUploadRules.reasonText(code)
            assertFalse(code, text.contains("인터넷") || text.contains("네트워크"))
            assertTrue(code, BackUploadRules.isCode(code))
        }
        assertTrue(BackUploadRules.reasonText(BackUploadRules.NETWORK).contains("인터넷"))
        assertEquals("사업 보고 올리기가 멈췄어요(1개 남음) · 서버가 잠시 답하지 않아요 · 앱을 열면 남은 것부터 다시 올려요", BackUploadRules.stoppedText(BackUploadRules.Run.Stopped(BackUploadRules.SERVER, true, 1, 2)))
        assertEquals("사업 보고에 자료 1개를 올렸어요", BackUploadRules.doneText(BackUploadRules.Run.Done(1, 0, 1, null, false)))
        assertEquals("사업 보고에 사진 1장을 올렸어요", BackUploadRules.doneText(BackUploadRules.Run.Done(1, 0, 1, null, true)))
    }

    // ── 상태·정리 ──

    @Test
    fun stateMessageListsJobsWithoutNamesOrSecrets() {
        val s = store()
        assertEquals("""up:state:{"v":1,"on":false,"kinds":["meeting"],"jobs":[]}""", BackUploadRules.stateMessage(false, s))
        assertEquals("""up:state:{"v":1,"on":true,"kinds":["meeting"],"jobs":[]}""", BackUploadRules.stateMessage(true, null))
        val batch = sealed(s, "비밀 이름.jpg" to "image/jpeg", t = BackUploadRules.Target("meeting", meeting, project))
        val text = BackUploadRules.stateMessage(true, s)
        assertTrue(text.startsWith("""up:state:{"v":1,"on":true,"kinds":["meeting"],"jobs":[{"id":"$batch","kind":"meeting","target":"$meeting","total":1,"left":1,"state":"run""""))
        // 파일 이름·사업영역·사진 칸은 다리 글에 싣지 않는다.
        assertFalse(text.contains("비밀"))
        assertFalse(text.contains(project))
        assertEquals("up:job:" + BackUploadRules.jobJson(s, batch), BackUploadRules.jobMessage(s, batch))
        assertNull(BackUploadRules.jobMessage(s, "abcdefghijklmnop_-012345"))
    }

    @Test
    fun sweepRemovesAbandonedAndStaleBatches() {
        val s = store()
        val root = File(tmp.root, "back-upload")
        val done = sealed(s, "a.jpg" to "image/jpeg")
        // 받다가 화면이 닫힌 묶음(닫지 않음)과 지금 받는 중인 묶음.
        val abandoned = s.create()
        s.begin(abandoned, 0)
        s.part(abandoned, 0, byteArrayOf(1))
        val current = s.create()
        s.begin(current, 0)
        File(root, "stray.txt").writeText("x")
        assertEquals(2, s.sweep(current))
        assertFalse(s.exists(abandoned))
        assertTrue(s.exists(current))
        assertTrue(s.exists(done))
        assertFalse(File(root, "stray.txt").exists())
        // 3일이 지나면 실패로 남은 묶음·끝난 묶음 기록도 지운다.
        clock += QuickPhotoRules.STALE_MS + 1
        assertEquals(2, s.sweep(null))
        assertFalse(s.exists(done))
        assertTrue(root.list()!!.isEmpty())
    }

    @Test
    fun resultsFileIgnoresBrokenLines() {
        val s = store()
        val batch = sealed(s, "a.jpg" to "image/jpeg", "b.jpg" to "image/jpeg")
        s.finish(batch, 0, doc1, null)
        // 같은 번호를 두 번 적지 않는다.
        s.finish(batch, 0, doc2, null)
        File(File(tmp.root, "back-upload"), "$batch/done").appendText("x\ty\tz\n1\tnot-a-uuid\t<b>\n")
        assertEquals(listOf(BackUploadStore.Result(0, doc1, null), BackUploadStore.Result(1, null, "unknown")), s.results(batch))
    }

    // ── 앱 부품 ──

    @Test
    fun bridgeAndWorkerStayInsideTheApp() {
        val main = File("src/main/java/kr/or/kptu/work/MainActivity.kt").readText()
        assertTrue(main.contains("data.startsWith(\"up:\")) onUploadMessage(data, reply)"))
        // 다리는 허용 Origin 최상위 화면 검사(같은 KPTUAppShell 받는 곳) 안에서만 불린다.
        val listener = main.substringAfter("WebViewCompat.addWebMessageListener(webView, BAR_BRIDGE, ShellRules.ALLOWED_ORIGINS)").substringBefore("// 웹 서비스 워커")
        assertTrue(listener.contains("if (!isMainFrame || sourceOrigin.toString() !in ShellRules.ALLOWED_ORIGINS) return@addWebMessageListener"))
        assertTrue(listener.contains("onUploadMessage(data, reply)"))
        val back = File("src/main/java/kr/or/kptu/work/BackUpload.kt").readText()
        // 임시 파일은 앱 전용·백업 제외 폴더 한 곳에만.
        assertTrue(back.contains("File(context.noBackupFilesDir, DIR)"))
        for (bad in listOf("getExternalFilesDir", "Environment.", "MediaStore", "cacheDir", "FileProvider")) assertFalse(bad, back.contains(bad))
        // 폰 알림줄 알림·새 권한·내보내는 부품을 더하지 않는다(위젯 [사진]과 같은 토스트 한 줄).
        for (name in listOf("BackUpload.kt", "BackUploadRules.kt")) {
            val text = File("src/main/java/kr/or/kptu/work/$name").readText()
            for (bad in listOf("POST_NOTIFICATIONS", "NotificationCompat", "NotificationManager", "BroadcastReceiver", "Log.")) assertFalse("$name: $bad", text.contains(bad))
        }
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertFalse(manifest.contains("BackUpload"))
        assertFalse(manifest.contains("FOREGROUND_SERVICE_DATA_SYNC"))
        assertEquals(14, Regex("<uses-permission ").findAll(manifest).count())
        // 토큰·세션은 다리 쪽 코드에 나오지 않는다(올리기는 Worker가 위젯 세션으로).
        val bridge = main.substringAfter("private fun onUploadMessage(").substringBefore("private fun postUp(")
        for (bad in listOf("accessToken", "WidgetHub.session", "Authorization", "refresh")) assertFalse(bad, bridge.contains(bad))
    }
}
