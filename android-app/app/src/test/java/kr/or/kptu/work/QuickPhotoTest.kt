package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream

/** APP-위젯빠른쓰기 남은 일 1: 위젯 [사진] 뒤에서 올리기(설계 13.7절). 정리함 첨부 올리기 하나만, 임시 파일은 올린 뒤 지움. */
class QuickPhotoTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val user = "11111111-2222-4333-8444-555555555555"
    private val note = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    private val note2 = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee"
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

    private fun photo(): File = tmp.newFile().apply { writeBytes(byteArrayOf(1, 2, 3)) }

    private fun ok(id: String) = reply(200, """{"ok":true,"note_id":"$id","attachments":[]}""")

    // ── 허용 요청 ──

    @Test
    fun onlyBasketUploadIsAdded() {
        assertTrue(WidgetRules.allowed("POST", "$base/functions/v1/basket-files"))
        assertFalse(WidgetRules.allowed("GET", "$base/functions/v1/basket-files"))
        for (a in listOf("note-delete", "photo-prune", "photo-orphans", "photo", "ocr")) {
            assertFalse(a, WidgetRules.allowed("POST", "$base/functions/v1/basket-files?action=$a"))
            assertFalse(a, WidgetRules.allowed("GET", "$base/functions/v1/basket-files?action=$a"))
        }
        assertFalse(WidgetRules.allowed("POST", "$base/functions/v1/library-files"))
    }

    @Test
    fun multipartShapeIsFixed() {
        val f = photo()
        val url = WidgetRules.BASKET_FILES
        val file = WidgetPart("file", file = f, fileName = "a.jpg", type = "image/jpeg")
        assertTrue(WidgetRules.allowedParts("POST", url, null, listOf(file)))
        assertTrue(WidgetRules.allowedParts("POST", url, null, listOf(file, WidgetPart("note_id", value = note))))
        // basket-files에 JSON 본문(글자 읽기·지우기 길)은 보내지 않는다.
        assertFalse(WidgetRules.allowedParts("POST", url, "{}", null))
        assertFalse(WidgetRules.allowedParts("POST", url, null, null))
        // 다른 칸·두 파일·잘못된 note_id·다른 주소의 multipart는 거절.
        assertFalse(WidgetRules.allowedParts("POST", url, null, listOf(file, WidgetPart("raw_text", value = "x"))))
        assertFalse(WidgetRules.allowedParts("POST", url, null, listOf(file, file)))
        assertFalse(WidgetRules.allowedParts("POST", url, null, listOf(file, WidgetPart("note_id", value = "x"))))
        assertFalse(WidgetRules.allowedParts("POST", url, null, listOf(WidgetPart("note_id", value = note))))
        assertFalse(WidgetRules.allowedParts("POST", WidgetRules.NOTES, null, listOf(file)))
        assertFalse(WidgetRules.allowedParts("POST", url, "{}", listOf(file)))
        // 다른 주소의 JSON 요청은 그대로.
        assertTrue(WidgetRules.allowedParts("POST", WidgetRules.NOTES, "{}", null))
    }

    // ── 올리기 ──

    @Test
    fun uploadSendsOneFileWithSessionToken() {
        signIn()
        val f = photo()
        http.answers.add(ok(note))
        val r = session.uploadPhoto(f, "사진 1.jpg", "image/jpeg", null)
        assertEquals(WidgetSession.Photo.Saved(note), r)
        val req = http.sent.single()
        assertEquals("POST", req.method)
        assertEquals("$base/functions/v1/basket-files", req.url)
        assertNull(req.body)
        assertEquals("Bearer a1", req.headers["Authorization"])
        assertFalse(req.headers.containsKey("Content-Type"))
        val parts = req.parts!!
        assertEquals(listOf("file"), parts.map { it.name })
        assertEquals(f, parts[0].file)
        assertEquals("사진 1.jpg", parts[0].fileName)
        assertEquals("image/jpeg", parts[0].type)
    }

    @Test
    fun laterPhotosJoinTheSameNote() {
        signIn()
        http.answers.add(ok(note))
        assertEquals(WidgetSession.Photo.Saved(note), session.uploadPhoto(photo(), "b.jpg", "image/jpeg", note))
        assertEquals(listOf("file", "note_id"), http.sent.single().parts!!.map { it.name })
        assertEquals(note, http.sent.single().parts!![1].value)
        // 서버가 다른 글 번호를 돌려주면 결과 모름(겹쳐 올리지 않음).
        http.answers.add(ok(note2))
        assertEquals(WidgetSession.Photo.Failed(QuickPhotoRules.UNKNOWN, false), session.uploadPhoto(photo(), "c.jpg", "image/jpeg", note))
    }

    @Test
    fun signedOutSendsNothing() {
        assertEquals(WidgetSession.Photo.SignedOut, session.uploadPhoto(photo(), "a.jpg", "image/jpeg", null))
        assertTrue(http.sent.isEmpty())
    }

    @Test
    fun unauthorizedRefreshesOnce() {
        signIn()
        http.answers.add(reply(401, "{}"))
        http.answers.add(reply(200, """{"access_token":"a2","refresh_token":"r2","expires_in":3600,"user":{"id":"$user"}}"""))
        http.answers.add(ok(note))
        assertEquals(WidgetSession.Photo.Saved(note), session.uploadPhoto(photo(), "a.jpg", "image/jpeg", null))
        assertEquals(listOf(WidgetRules.BASKET_FILES, WidgetRules.TOKEN, WidgetRules.BASKET_FILES), http.sent.map { it.url })
        assertEquals("Bearer a2", http.sent[2].headers["Authorization"])
    }

    @Test
    fun networkErrorKeepsPhotoForRetry() {
        signIn()
        http.answers.add { throw IOException("x") }
        assertEquals(WidgetSession.Photo.Failed(QuickPhotoRules.NETWORK, true), session.uploadPhoto(photo(), "a.jpg", "image/jpeg", null))
    }

    @Test
    fun serverAnswersMapToOneLine() {
        fun r(code: Int, body: String, n: String? = null) = QuickPhotoRules.result(code, MiniJson.parse(body), n)
        assertEquals(WidgetSession.Photo.Saved(note), r(200, """{"ok":true,"note_id":"$note"}"""))
        assertEquals(WidgetSession.Photo.Failed(QuickPhotoRules.UNKNOWN, false), r(200, """{"ok":true}"""))
        assertEquals(WidgetSession.Photo.Failed(QuickPhotoRules.UNKNOWN, false), r(503, """{"code":"note_save_result_unknown"}"""))
        assertEquals(WidgetSession.Photo.Failed(QuickPhotoRules.SERVER, true), r(503, """{"code":"drive_upload"}"""))
        assertEquals(WidgetSession.Photo.Failed(QuickPhotoRules.NOTE_GONE, true, forgetNote = true), r(404, """{"code":"note_not_found"}""", note))
        assertEquals(WidgetSession.Photo.Failed(QuickPhotoRules.SERVER, true), r(409, """{"code":"note_changed"}""", note))
        assertEquals(WidgetSession.Photo.Failed(QuickPhotoRules.TOO_BIG, false), r(413, """{"code":"file_too_large"}"""))
        assertEquals(WidgetSession.Photo.Failed(QuickPhotoRules.TOO_MANY, false), r(400, """{"code":"too_many_attachments"}"""))
        assertEquals(WidgetSession.Photo.Failed(QuickPhotoRules.FORBIDDEN, false), r(403, """{"code":"forbidden"}"""))
        assertEquals(WidgetSession.Photo.Failed("사진을 올리지 못했어요(400)", false), r(400, """{"code":"file_metadata_invalid"}"""))
    }

    @Test
    fun namesAndTypesAreCleaned() {
        assertEquals("a b.jpg", QuickPhotoRules.uploadName("a\tb.jpg", 0))
        assertEquals("공유 파일 2", QuickPhotoRules.uploadName(null, 1))
        assertEquals("image/png", QuickPhotoRules.uploadType("image/png"))
        assertEquals("image/jpeg", QuickPhotoRules.uploadType("application/octet-stream"))
        assertEquals("image/jpeg", QuickPhotoRules.uploadType(null))
    }

    // ── 임시 파일 묶음 ──

    private fun bytes(n: Int): InputStream = ByteArrayInputStream(ByteArray(n) { 7 })

    @Test
    fun storeCopiesThenDeletesEachUploadedPhoto() {
        val root = tmp.newFolder("quick-photo")
        val store = QuickPhotoStore(root) { 5_000L }
        val b = store.create()
        assertTrue(QuickPhotoRules.isBatch(b))
        assertTrue(store.add(b, 0, bytes(10)))
        assertFalse(store.add(b, 1, bytes(0)))
        assertTrue(store.add(b, 2, bytes(5)))
        store.seal(b, listOf(Triple(0, "image/jpeg", "a.jpg"), Triple(2, "image/png", "c\n.png")))
        assertEquals(2, store.total(b))
        assertEquals(listOf(0, 2), store.items(b).map { it.index })
        assertEquals("c .png", store.items(b)[1].name)

        val seen = ArrayList<String?>()
        val run = QuickPhotoRules.run(store, b) { _, n ->
            seen.add(n)
            WidgetSession.Photo.Saved(note)
        }
        assertEquals(QuickPhotoRules.Run.Done(2), run)
        assertEquals(listOf(null, note), seen)
        // 다 올리면 임시 폴더를 지운다.
        assertFalse(store.exists(b))
        assertTrue(root.listFiles()!!.isEmpty())
    }

    @Test
    fun failureKeepsOnlyUnsentPhotosAndRetryContinuesSameNote() {
        val store = QuickPhotoStore(tmp.newFolder("q")) { 5_000L }
        val b = store.create()
        for (i in 0..2) assertTrue(store.add(b, i, bytes(3)))
        store.seal(b, (0..2).map { Triple(it, "image/jpeg", "$it.jpg") })
        var calls = 0
        val first = QuickPhotoRules.run(store, b) { _, _ ->
            calls++
            if (calls == 1) WidgetSession.Photo.Saved(note) else WidgetSession.Photo.Failed(QuickPhotoRules.NETWORK, true)
        }
        assertEquals(QuickPhotoRules.Run.Stopped(QuickPhotoRules.NETWORK, true, 1, 3), first)
        assertEquals(
            "사진 3장 중 2장을 못 올렸어요 · " + QuickPhotoRules.NETWORK + " · " + QuickPhotoRules.RESUME,
            QuickPhotoRules.failed(first as QuickPhotoRules.Run.Stopped),
        )
        // 멈춘 묶음은 다음 [사진] 때 이어 올릴 목록에 있다.
        assertEquals(listOf(b), store.pending())
        assertEquals(listOf(1, 2), store.items(b).map { it.index })
        assertEquals(note, store.note(b))
        // [다시 시도]: 남은 두 장만, 같은 정리함 글에 이어 붙인다.
        val seen = ArrayList<Pair<Int, String?>>()
        val second = QuickPhotoRules.run(store, b) { item, n ->
            seen.add(item.index to n)
            WidgetSession.Photo.Saved(note)
        }
        assertEquals(QuickPhotoRules.Run.Done(3), second)
        assertEquals(listOf(1 to note, 2 to note), seen)
        assertFalse(store.exists(b))
    }

    @Test
    fun signedOutKeepsPhotosForRetry() {
        val store = QuickPhotoStore(tmp.newFolder("q")) { 5_000L }
        val b = store.create()
        assertTrue(store.add(b, 0, bytes(3)))
        store.seal(b, listOf(Triple(0, "image/jpeg", "a.jpg")))
        val run = QuickPhotoRules.run(store, b) { _, _ -> WidgetSession.Photo.SignedOut }
        assertEquals(QuickPhotoRules.Run.Stopped(QuickPhotoRules.SIGNED_OUT, true, 0, 1), run)
        assertEquals(1, store.items(b).size)
        // 로그인 풀림은 저절로 다시 하지 않고(로그인 뒤 [사진]으로 이어 올림), 같은 안내를 두 번 붙이지 않는다.
        assertFalse(QuickPhotoRules.autoRetry(run as QuickPhotoRules.Run.Stopped, 0))
        assertEquals("사진을 정리함에 올리지 못했어요 · " + QuickPhotoRules.SIGNED_OUT, QuickPhotoRules.failed(run))
    }

    @Test
    fun unknownResultDropsBatchSoNothingIsSentTwice() {
        val store = QuickPhotoStore(tmp.newFolder("q")) { 5_000L }
        val b = store.create()
        for (i in 0..1) assertTrue(store.add(b, i, bytes(3)))
        store.seal(b, (0..1).map { Triple(it, "image/jpeg", "$it.jpg") })
        val run = QuickPhotoRules.run(store, b) { _, _ -> WidgetSession.Photo.Failed(QuickPhotoRules.UNKNOWN, false) }
        assertEquals(QuickPhotoRules.Run.Stopped(QuickPhotoRules.UNKNOWN, false, 0, 2), run)
        assertFalse(store.exists(b))
    }

    @Test
    fun goneNoteStartsANewOneOnRetry() {
        val store = QuickPhotoStore(tmp.newFolder("q")) { 5_000L }
        val b = store.create()
        assertTrue(store.add(b, 0, bytes(3)))
        store.seal(b, listOf(Triple(0, "image/jpeg", "a.jpg")))
        store.setNote(b, note)
        QuickPhotoRules.run(store, b) { _, _ -> WidgetSession.Photo.Failed(QuickPhotoRules.NOTE_GONE, true, forgetNote = true) }
        assertNull(store.note(b))
        assertEquals(1, store.items(b).size)
    }

    @Test
    fun missingFilesAreReportedNotSilentlyDone() {
        val store = QuickPhotoStore(tmp.newFolder("q")) { 5_000L }
        val b = store.create()
        assertTrue(store.add(b, 0, bytes(3)))
        store.seal(b, listOf(Triple(0, "image/jpeg", "a.jpg")))
        store.done(b, store.items(b)[0])
        val run = QuickPhotoRules.run(store, b) { _, _ -> throw AssertionError("no upload") }
        assertEquals(QuickPhotoRules.Run.Stopped(QuickPhotoRules.MISSING, false, 0, 1), run)
        assertFalse(store.exists(b))
    }

    @Test
    fun tooLargePhotoIsNotKept() {
        val store = QuickPhotoStore(tmp.newFolder("q")) { 5_000L }
        val b = store.create()
        val big = object : InputStream() {
            var left = QuickPhotoRules.MAX_BYTES + 1
            override fun read(): Int = if (left-- > 0) 1 else -1
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (left <= 0) return -1
                val n = minOf(len.toLong(), left).toInt()
                left -= n
                return n
            }
        }
        assertFalse(store.add(b, 0, big))
        assertFalse(File(File(tmp.root, "q"), "$b/0").exists())
    }

    @Test
    fun staleBatchesArePruned() {
        var now = 1_000L
        val root = tmp.newFolder("q")
        val store = QuickPhotoStore(root) { now }
        val old = store.create()
        assertTrue(store.add(old, 0, bytes(3)))
        store.seal(old, listOf(Triple(0, "image/jpeg", "a.jpg")))
        File(root, "stray.txt").writeText("x")
        now += QuickPhotoRules.STALE_MS + 1
        val fresh = store.create()
        store.seal(fresh, emptyList())
        assertEquals(2, store.prune())
        assertFalse(store.exists(old))
        assertTrue(store.exists(fresh))
    }

    @Test
    fun autoRetryOnlyForPassingFailuresThreeTimes() {
        val net = QuickPhotoRules.Run.Stopped(QuickPhotoRules.NETWORK, true, 0, 1)
        assertTrue(QuickPhotoRules.autoRetry(net, 0))
        assertTrue(QuickPhotoRules.autoRetry(net, 1))
        assertFalse(QuickPhotoRules.autoRetry(net, 2))
        assertFalse(QuickPhotoRules.autoRetry(QuickPhotoRules.Run.Stopped(QuickPhotoRules.UNKNOWN, false, 0, 1), 0))
        assertEquals("사진을 정리함에 올리지 못했어요 · " + QuickPhotoRules.UNKNOWN, QuickPhotoRules.failed(QuickPhotoRules.Run.Stopped(QuickPhotoRules.UNKNOWN, false, 0, 1)))
    }

    @Test
    fun pendingSkipsBatchesStillCopyingOrFinished() {
        val store = QuickPhotoStore(tmp.newFolder("q")) { 5_000L }
        val copying = store.create()
        assertTrue(store.add(copying, 0, bytes(3)))
        val left = store.create()
        assertTrue(store.add(left, 0, bytes(3)))
        store.seal(left, listOf(Triple(0, "image/jpeg", "a.jpg")))
        val empty = store.create()
        store.seal(empty, listOf(Triple(0, "image/jpeg", "a.jpg")))
        assertEquals(listOf(left), store.pending())
    }

    @Test
    fun batchIdsAreChecked() {
        assertFalse(QuickPhotoRules.isBatch(null))
        assertFalse(QuickPhotoRules.isBatch("../x"))
        assertFalse(QuickPhotoRules.isBatch("short"))
        assertTrue(QuickPhotoRules.isBatch("abcdefghijklmnop_-12"))
    }

    // ── 창·알림 받기 ──

    @Test
    fun photoCellClosesAndUploadsInBackground() {
        val widgets = File("src/main/java/kr/or/kptu/work/ActionWidgets.kt").readText()
        assertTrue(widgets.contains("QuickPhoto.stage("))
        assertTrue(widgets.contains("QuickPhoto.start("))
        // 위젯 로그인이 없으면 지금처럼 공유 받기 길.
        assertTrue(widgets.contains("shareToWeb(content)"))
        // 다음 [사진] 때 멈춘 묶음을 이어 올린다.
        assertTrue(widgets.contains("QuickPhoto.resume("))
        // 폰 알림줄 알림·알림 권한은 쓰지 않는다(녹음 알림줄 전용, collaboration-ownership-check). 실패는 토스트 한 줄.
        for (name in listOf("QuickPhoto.kt", "QuickPhotoRules.kt")) {
            val text = File("src/main/java/kr/or/kptu/work/$name").readText()
            for (bad in listOf("POST_NOTIFICATIONS", "NotificationCompat", "NotificationManager", "BroadcastReceiver")) assertFalse("$name: $bad", text.contains(bad))
        }
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertFalse(manifest.contains("QuickPhoto"))
        assertFalse(manifest.contains("FOREGROUND_SERVICE_DATA_SYNC"))
        assertEquals(12, Regex("<uses-permission ").findAll(manifest).count())
    }
}
