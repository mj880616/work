package kr.or.kptu.work

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.security.SecureRandom

/**
 * APP-위젯빠른쓰기 남은 일 1: 위젯 [사진] 뒤에서 올리기(설계 docs/design/phone-widget-auth.md 13.7절).
 * 안드로이드 API를 쓰지 않아 JVM 시험 대상이다(QuickPhotoTest).
 * - 사진을 고르면 창은 바로 닫히고, 앱 전용 공간의 임시 파일에서 정리함 첨부 올리기(basket-files, 웹 uploadBatch와 같은 길)로 뒤에서 올린다.
 * - 여러 장은 첫 장이 만든 정리함 글 하나에 이어 붙인다(웹과 같음). 올린 장은 바로 지우고, 다 올리면 묶음 폴더를 지운다.
 * - 일시 오류는 저절로 다시(최대 3번). 그래도 안 되면 한 줄(토스트) 알리고 남은 사진은 두었다가 다음에 [사진]을 누르면 이어 올린다.
 *   이미 올린 장은 다시 올리지 않는다. 3일 지난 묶음은 지운다. 폰 알림줄 알림은 쓰지 않는다(알림 권한은 녹음 전용).
 * - 서버·DB·Edge 변경 없음. 작업공간·소유자는 서버(basket-files)가 로그인 사용자로 정한다.
 * 로그·오류에 파일 이름·토큰·응답 원문을 싣지 않는다.
 */
object QuickPhotoRules {
    /** basket-files 한도(MAX_ATTACHMENTS 20, MAX_FILE 100MiB)와 같다. */
    const val MAX_FILES = 20
    const val MAX_BYTES = 100L * 1024 * 1024
    /** 실패한 채 남은 묶음을 지우는 때. */
    const val STALE_MS = 3L * 24 * 60 * 60 * 1000

    private val BATCH = Regex("^[A-Za-z0-9_-]{16,64}$")

    fun isBatch(value: String?): Boolean = value != null && BATCH.matches(value)

    /** 올리는 이름(공유 받기와 같은 정리: 제어 문자·경로 기호 없음, 200자). */
    fun uploadName(name: String?, index: Int): String = ShellRules.shareName(name, index).replace('\t', ' ')

    /** 올리는 종류. 사진 고르기에서 왔으므로 image/… 가 아니면 image/jpeg(서버는 형식만 본다). */
    fun uploadType(type: String?): String {
        val t = ShellRules.shareMime(type)
        return if (t.startsWith("image/")) t else "image/jpeg"
    }

    /** multipart 칸: 파일 하나 + (이어 붙일 때) note_id. WidgetRules.allowedParts가 같은 모양만 받는다. */
    fun parts(file: File, name: String, type: String, noteId: String?): List<WidgetPart> {
        require(noteId == null || WidgetRules.isUserId(noteId))
        val out = arrayListOf(WidgetPart("file", file = file, fileName = name, type = type))
        if (noteId != null) out.add(WidgetPart("note_id", value = noteId))
        return out
    }

    /** 서버 답 → 한 장의 결과. */
    fun result(status: Int, body: Any?, noteId: String?): WidgetSession.Photo {
        val map = MiniJson.obj(body)
        val code = MiniJson.str(map?.get("code")) ?: ""
        if (status == 200) {
            val id = MiniJson.str(map?.get("note_id"))
            val ok = map?.get("ok") == true && WidgetRules.isUserId(id) && (noteId == null || noteId.equals(id, ignoreCase = true))
            return if (ok) WidgetSession.Photo.Saved(id!!) else WidgetSession.Photo.Failed(UNKNOWN, false)
        }
        return when {
            code == "note_save_result_unknown" -> WidgetSession.Photo.Failed(UNKNOWN, false)
            status == 404 && code == "note_not_found" -> WidgetSession.Photo.Failed(NOTE_GONE, true, forgetNote = true)
            status == 409 -> WidgetSession.Photo.Failed(SERVER, true)
            status == 413 || code == "file_too_large" -> WidgetSession.Photo.Failed(TOO_BIG, false)
            code == "too_many_attachments" -> WidgetSession.Photo.Failed(TOO_MANY, false)
            status == 403 -> WidgetSession.Photo.Failed(FORBIDDEN, false)
            status == 408 || status == 429 || status in 500..599 -> WidgetSession.Photo.Failed(SERVER, true)
            else -> WidgetSession.Photo.Failed("사진을 올리지 못했어요($status)", false)
        }
    }

    /** 묶음 한 번 돌린 결과. */
    sealed class Run {
        /** 다 올림(saved: 이번 묶음 전체 장 수). 묶음 폴더는 지웠다. */
        data class Done(val saved: Int) : Run()
        /** 멈춤. retry면 남은 장이 그대로 있어 [다시 시도]로 이어 올린다. 아니면 묶음을 지웠다. */
        data class Stopped(val reason: String, val retry: Boolean, val saved: Int, val total: Int) : Run()
    }

    /**
     * 남은 장을 차례로 올린다. 한 장 올릴 때마다 그 임시 파일을 지우고 정리함 글 번호를 적는다(다시 시도 때 이어 붙임).
     * 로그인 풀림·다시 될 실패는 남은 장을 두고 멈춘다. 다시 안 될 실패(결과 모름·너무 큼·권한)는 묶음을 지우고 멈춘다(겹쳐 올리지 않게).
     */
    fun run(store: QuickPhotoStore, batch: String, upload: (QuickPhotoStore.Item, String?) -> WidgetSession.Photo): Run {
        val total = store.total(batch)
        val items = store.items(batch)
        var note = store.note(batch)
        if (total <= 0 || items.isEmpty()) {
            store.drop(batch)
            // 올린 기록(정리함 글 번호)이 있으면 앞에서 다 올린 묶음, 없으면 임시 파일이 사라진 묶음.
            return if (total > 0 && note == null) Run.Stopped(MISSING, false, 0, total) else Run.Done(total.coerceAtLeast(0))
        }
        for (item in items) {
            when (val r = upload(item, note)) {
                is WidgetSession.Photo.Saved -> {
                    note = r.noteId
                    store.setNote(batch, r.noteId)
                    store.done(batch, item)
                }
                WidgetSession.Photo.SignedOut -> return Run.Stopped(SIGNED_OUT, true, total - store.items(batch).size, total)
                is WidgetSession.Photo.Failed -> {
                    if (r.forgetNote) store.setNote(batch, null)
                    if (!r.retry) {
                        val left = store.items(batch).size
                        store.drop(batch)
                        return Run.Stopped(r.reason, false, total - left, total)
                    }
                    return Run.Stopped(r.reason, true, total - store.items(batch).size, total)
                }
            }
        }
        store.drop(batch)
        return Run.Done(total)
    }

    fun staged(count: Int, skipped: Int): String =
        "정리함에 사진 ${count}장을 올리는 중이에요" + (if (skipped > 0) " · ${skipped}장은 뺐어요(20장·100MB까지)" else "")

    fun saved(count: Int): String = if (count <= 1) "정리함에 사진을 넣었어요" else "정리함에 사진 ${count}장을 넣었어요"

    /** 실패 한 줄(토스트). 다시 될 실패면 다음 [사진]에서 이어 올린다고 알린다. */
    fun failed(run: Run.Stopped): String {
        val head = if (run.saved > 0) "사진 ${run.total}장 중 ${run.total - run.saved}장을 못 올렸어요" else "사진을 정리함에 올리지 못했어요"
        val tail = if (run.retry && run.reason != SIGNED_OUT) " · " + RESUME else ""
        return head + " · " + run.reason + tail
    }

    /** WorkManager가 저절로 다시 할지: 다시 될 실패(로그인 풀림 제외)이고 3번 안쪽. runAttemptCount는 0부터. */
    const val AUTO_RETRIES = 3

    fun autoRetry(run: Run.Stopped, attempts: Int): Boolean = run.retry && run.reason != SIGNED_OUT && attempts < AUTO_RETRIES - 1

    const val NETWORK = "인터넷 연결을 확인해 주세요"
    const val SIGNED_OUT = "위젯 로그인이 풀렸어요 · 위젯에서 로그인 뒤 [사진]을 누르면 이어 올려요"
    const val RESUME = "위젯 [사진]을 누르면 남은 사진부터 다시 올려요"
    const val SERVER = "서버가 잠시 답하지 않아요"
    const val UNKNOWN = "올렸는지 확인하지 못했어요 · 정리함을 확인해 주세요"
    const val NOTE_GONE = "이어 붙일 정리함 글이 지워졌어요 · 남은 사진은 새 글로 넣어요"
    const val TOO_BIG = "사진이 너무 커요(100MB까지)"
    const val TOO_MANY = "한 번에 20장까지 넣을 수 있어요"
    const val FORBIDDEN = "저장 권한을 확인하지 못했어요"
    const val MISSING = "임시 파일이 사라졌어요 · 사진을 다시 골라 주세요"
}

/**
 * [사진] 뒤에서 올리기의 임시 파일 묶음(앱 전용 공간, 백업 제외 폴더). 묶음마다 폴더 하나:
 * meta(판·만든 시각·장마다 번호·종류·이름), 장마다 파일 '0'·'1'…, 이어 붙일 정리함 글 번호 'note'.
 * 올린 장은 바로 지우고 다 올리면 폴더째 지운다. 안드로이드 API 없이 java.io만 써서 JVM 시험 대상이다.
 */
class QuickPhotoStore(private val root: File, private val now: () -> Long = System::currentTimeMillis) {
    data class Item(val index: Int, val name: String, val type: String, val file: File)

    private val random = SecureRandom()

    private fun dir(batch: String): File {
        require(QuickPhotoRules.isBatch(batch))
        return File(root, batch)
    }

    /** 새 묶음(빈 폴더). */
    fun create(): String {
        val bytes = ByteArray(18)
        random.nextBytes(bytes)
        val id = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        if (!dir(id).mkdirs()) throw IOException("mkdir")
        return id
    }

    /** 한 장을 복사한다. 비었거나 100MiB를 넘으면 지우고 false. */
    fun add(batch: String, index: Int, input: InputStream): Boolean {
        val f = File(dir(batch), index.toString())
        var size = 0L
        try {
            f.outputStream().use { out ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    size += n
                    if (size > QuickPhotoRules.MAX_BYTES) break
                    out.write(buf, 0, n)
                }
            }
        } catch (e: IOException) {
            f.delete()
            throw e
        }
        if (size <= 0L || size > QuickPhotoRules.MAX_BYTES) {
            f.delete()
            return false
        }
        return true
    }

    /** 복사를 마친 장들의 목록을 적는다(이것이 있어야 올릴 묶음이다). */
    fun seal(batch: String, items: List<Triple<Int, String, String>>) {
        val sb = StringBuilder("v1\n").append(now()).append('\n')
        for ((i, type, name) in items) sb.append(i).append('\t').append(type).append('\t').append(name.replace(Regex("[\\t\\r\\n]"), " ")).append('\n')
        File(dir(batch), "meta").writeText(sb.toString())
    }

    private fun meta(batch: String): Pair<Long, List<Triple<Int, String, String>>>? {
        val f = File(dir(batch), "meta")
        if (!f.isFile) return null
        val lines = try {
            f.readLines()
        } catch (_: IOException) {
            return null
        }
        if (lines.size < 2 || lines[0] != "v1") return null
        val at = lines[1].toLongOrNull() ?: return null
        val items = lines.drop(2).filter { it.isNotEmpty() }.mapNotNull { line ->
            val p = line.split('\t', limit = 3)
            val i = p.getOrNull(0)?.toIntOrNull()
            if (p.size != 3 || i == null || i < 0) null else Triple(i, p[1], p[2])
        }
        return at to items
    }

    /** 이 묶음의 전체 장 수(목록이 없으면 0). */
    fun total(batch: String): Int = meta(batch)?.second?.size ?: 0

    /** 아직 올리지 않은 장(파일이 남은 것), 번호 순. */
    fun items(batch: String): List<Item> {
        val d = dir(batch)
        return meta(batch)?.second.orEmpty().sortedBy { it.first }.mapNotNull { (i, type, name) ->
            val f = File(d, i.toString())
            if (f.isFile) Item(i, name, type, f) else null
        }
    }

    fun note(batch: String): String? {
        val f = File(dir(batch), "note")
        val v = try {
            if (f.isFile) f.readText().trim() else null
        } catch (_: IOException) {
            null
        }
        return v?.takeIf { WidgetRules.isUserId(it) }
    }

    fun setNote(batch: String, noteId: String?) {
        val f = File(dir(batch), "note")
        if (noteId == null) f.delete() else {
            require(WidgetRules.isUserId(noteId))
            f.writeText(noteId)
        }
    }

    fun done(batch: String, item: Item) {
        File(dir(batch), item.index.toString()).delete()
    }

    fun exists(batch: String): Boolean = dir(batch).isDirectory

    /** 목록을 마쳤고 아직 올리지 않은 장이 남은 묶음(멈춘 것). 복사 중인 묶음(목록 없음)은 뺀다. */
    fun pending(): List<String> =
        root.listFiles().orEmpty().filter { it.isDirectory && QuickPhotoRules.isBatch(it.name) }.map { it.name }
            .filter { total(it) > 0 && items(it).isNotEmpty() }.sorted()

    /** 묶음 폴더를 통째로 지운다(임시 파일 정리). */
    fun drop(batch: String) {
        dir(batch).deleteRecursively()
    }

    /** 3일 지난 묶음과 목록이 없는 오래된 폴더(복사 중 꺼짐)를 지운다. 지운 수. */
    fun prune(): Int {
        val list = root.listFiles() ?: return 0
        var n = 0
        for (d in list) {
            if (!d.isDirectory || !QuickPhotoRules.isBatch(d.name)) {
                d.deleteRecursively()
                n++
                continue
            }
            val at = meta(d.name)?.first ?: d.lastModified()
            val age = now() - at
            if (age > QuickPhotoRules.STALE_MS || age < -QuickPhotoRules.STALE_MS) {
                d.deleteRecursively()
                n++
            }
        }
        return n
    }
}
