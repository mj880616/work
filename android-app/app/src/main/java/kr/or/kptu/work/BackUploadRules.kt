package kr.or.kptu.work

import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * APP-뒤에서올리기 1단계(요청함 11/11 06:56, 설계 docs/design/phone-widget-auth.md 16절).
 * 웹 화면(폰 앱 안)이 고른 사진·파일을 앱에 넘기면, 앱이 앱 전용 임시 폴더에 두고 WorkManager로 뒤에서 올린다.
 * 다른 앱으로 가도·앱을 닫아도·인터넷이 잠깐 끊겨도 이어서 올린다. 위젯 [사진](QuickPhoto, 13.7절)과 같은 길을 넓힌 것이다.
 * 안드로이드 API를 쓰지 않아 JVM 시험 대상이다(BackUploadTest). 안드로이드 부분은 BackUpload.kt.
 *
 * 다리(KPTUAppShell, 허용 Origin 최상위 화면만):
 * - up:hello                                              → up:state:{"v":1,"on","kinds":["meeting"],"jobs":[job…]}
 * - up:start:{"kind":"meeting","meeting","project","count"} → up:ack:{"ok","step":"start","error","id":"<묶음>"}
 * - up:begin:{"name","mime","size","title","category","date"} → up:ack step begin   파일 하나 시작
 *   up:part:<base64> → step part, up:end → step end                                   (앱 전용 폴더 back-upload/<묶음>/ 에 한 개씩)
 * - up:go                                                 → up:ack step go          묶음을 닫고 뒤에서 올리기를 건다
 * - up:cancel                                                                        받다 만 묶음 버림
 * - up:seen:<묶음>                                                                   끝난 묶음 기록 지움
 * - (앱 → 웹) up:job:{"id","kind","target","total","left","state","reason","docs":[…],"errors":[…]}   묶음 진행·끝(state: run·done·stopped)
 * 넘기는 것은 파일 바이트와 대상 id, 사진 칸(제목·종류·날짜)뿐이다. 로그인 정보·토큰은 웹↔앱 어느 쪽으로도 넘기지 않는다.
 * 서버 입구는 지금 것 하나(library-files, 웹 uploadFileForMeeting과 같은 multipart). 서버·DB·Edge 변경 없음.
 * 로그·다리 글에 파일 이름·내용·토큰·응답 원문을 싣지 않는다.
 */
object BackUploadRules {
    /** library-files 한도(100MiB)·한 묶음 개수(위젯 [사진]과 같음). */
    const val MAX_FILES = QuickPhotoRules.MAX_FILES
    const val MAX_BYTES = QuickPhotoRules.MAX_BYTES
    /** 한 조각(base64 글자 수). 웹은 384KB 바이트씩 보낸다(base64 512KB). ShareOut과 같다. */
    const val PART_MAX = 700_000
    const val KIND_MEETING = "meeting"
    /** 이 판이 뒤에서 올릴 수 있는 대상. 1단계는 사업 보고 사진·회의자료 하나. */
    val KINDS = listOf(KIND_MEETING)
    const val TITLE_MAX = 200
    const val CATEGORY_MAX = 40
    /** up:hello 답에 싣는 묶음 수(가장 새 것부터). */
    const val JOBS_MAX = 20

    private val DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")
    private val B64 = Regex("^[A-Za-z0-9+/]*={0,2}$")
    private val CODE = Regex("^[a-z_]{1,20}$")

    /** 올릴 곳: 사업 보고(meeting uuid)와 선택 사업영역(project uuid). 작업공간·소유자는 서버가 로그인 사용자로 정한다. */
    data class Target(val kind: String, val meeting: String, val project: String?)

    /** 사진 칸(웹 photoUploadFields와 같은 세 가지). 없으면 서버 기본값. */
    data class Fields(val title: String? = null, val category: String? = null, val date: String? = null)

    sealed class Message {
        object Hello : Message()
        data class Start(val target: Target, val count: Int) : Message()
        data class Begin(val name: String, val mime: String, val size: Long, val fields: Fields) : Message()
        data class Part(val base64: String) : Message()
        object End : Message()
        object Go : Message()
        object Cancel : Message()
        data class Seen(val batch: String) : Message()
    }

    fun message(data: String?): Message? {
        if (data == null || data.length > PART_MAX + 40) return null
        return when {
            data == "up:hello" -> Message.Hello
            data.startsWith("up:start:") -> start(data.substring("up:start:".length))
            data.startsWith("up:begin:") -> begin(data.substring("up:begin:".length))
            data.startsWith("up:part:") -> data.substring("up:part:".length)
                .takeIf { it.isNotEmpty() && it.length <= PART_MAX && it.length % 4 == 0 && B64.matches(it) }?.let { Message.Part(it) }
            data == "up:end" -> Message.End
            data == "up:go" -> Message.Go
            data == "up:cancel" -> Message.Cancel
            data.startsWith("up:seen:") -> data.substring("up:seen:".length).takeIf { QuickPhotoRules.isBatch(it) }?.let { Message.Seen(it) }
            else -> null
        }
    }

    private fun json(raw: String, max: Int): Map<String, Any?>? {
        if (raw.length > max) return null
        return try {
            MiniJson.obj(MiniJson.parse(raw))
        } catch (_: Exception) {
            null
        }
    }

    private fun start(raw: String): Message.Start? {
        val o = json(raw, 400) ?: return null
        if (MiniJson.str(o["kind"]) != KIND_MEETING) return null
        val meeting = MiniJson.str(o["meeting"])?.lowercase()?.takeIf { WidgetRules.isUserId(it) } ?: return null
        // 사업영역은 선택. 빈 글·없음은 '없음', 그 밖에는 uuid여야 한다.
        val project = when (val p = o["project"]) {
            null -> null
            is String -> if (p.isEmpty()) null else p.lowercase().takeIf { WidgetRules.isUserId(it) } ?: return null
            else -> return null
        }
        val n = MiniJson.num(o["count"])?.takeIf { it == Math.floor(it) }?.toInt() ?: return null
        return if (n in 1..MAX_FILES) Message.Start(Target(KIND_MEETING, meeting, project), n) else null
    }

    private fun begin(raw: String): Message.Begin? {
        val o = json(raw, 4000) ?: return null
        val size = MiniJson.num(o["size"])?.takeIf { it == Math.floor(it) }?.toLong() ?: return null
        if (size !in 1..MAX_BYTES) return null
        val date = when (val d = o["date"]) {
            null -> null
            is String -> if (d.isEmpty()) null else d.takeIf { DATE.matches(it) } ?: return null
            else -> return null
        }
        val name = MiniJson.str(o["name"]) ?: ""
        return Message.Begin(name, ShellRules.shareMime(MiniJson.str(o["mime"])), size, Fields(clean(o["title"], TITLE_MAX), clean(o["category"], CATEGORY_MAX), date))
    }

    /** 글 칸 정리: 제어 글자 없이, 앞뒤 공백 없이, 한도까지. 비면 없음. */
    private fun clean(value: Any?, max: Int): String? {
        val s = (value as? String ?: return null).replace(Regex("[\\u0000-\\u001f\\u007f]+"), " ").trim()
        val cut = s.codePoints().limit(max.toLong()).toArray().let { String(it, 0, it.size) }.trim()
        return cut.ifEmpty { null }
    }

    /** 올리는 이름(공유 받기와 같은 정리: 제어 글자·경로 기호 없음, 200자). */
    fun uploadName(name: String?, index: Int): String = QuickPhotoRules.uploadName(name, index)

    // ── 받는 중인 묶음(웹이 넘기는 중) ──

    /** 받는 중인 묶음 하나: 선언한 개수까지, 한 개 100MiB까지, 받는 중인 한 개는 선언한 크기를 넘지 못한다. */
    class Intake(val batch: String, val target: Target, val count: Int) {
        data class Entry(val index: Int, val name: String, val mime: String, val fields: Fields)

        private val list = ArrayList<Entry>()
        val entries: List<Entry> get() = list
        var current: Entry? = null
            private set
        private var saving: PhotoEditRules.Saving? = null

        /** 받는 중인 한 개의 선언한 크기(없으면 0). */
        val currentSize: Long get() = saving?.size ?: 0L

        fun begin(m: Message.Begin): Entry? {
            if (current != null || list.size >= count || m.size !in 1..MAX_BYTES) return null
            val index = list.size
            val e = Entry(index, uploadName(m.name, index), m.mime, m.fields)
            current = e
            saving = PhotoEditRules.Saving(m.size)
            return e
        }

        fun part(n: Int): Boolean = saving?.add(n) == true

        /** 받는 중인 한 개 끝. 크기가 선언과 같아야 그 파일을 센다. 돌려주는 값: 센 파일(아니면 null, 받던 것은 버린다). */
        fun end(): Entry? {
            val e = current ?: return null
            val ok = saving?.complete == true
            current = null
            saving = null
            if (!ok) return null
            list.add(e)
            return e
        }

        val ready: Boolean get() = current == null && list.size == count
    }

    // ── 서버 요청 모양(WidgetRules.allowedParts가 이 모양만 받는다) ──

    /** multipart 칸: 파일 하나 + meeting_id + (선택) project_id·title·category·document_date. 웹 luUploadFileForMeeting과 같다. */
    fun parts(file: File, name: String, type: String, target: Target, fields: Fields): List<WidgetPart> {
        require(target.kind == KIND_MEETING && WidgetRules.isUserId(target.meeting))
        require(target.project == null || WidgetRules.isUserId(target.project))
        val out = arrayListOf(WidgetPart("file", file = file, fileName = name, type = type), WidgetPart("meeting_id", value = target.meeting))
        target.project?.let { out.add(WidgetPart("project_id", value = it)) }
        fields.title?.let { out.add(WidgetPart("title", value = it)) }
        fields.category?.let { out.add(WidgetPart("category", value = it)) }
        fields.date?.let { out.add(WidgetPart("document_date", value = it)) }
        return out
    }

    /**
     * library-files multipart 모양 검사: 'file' 파일 칸 정확히 하나 + 'meeting_id'(uuid) 정확히 하나
     * + 선택 'project_id'(uuid)·'title'(200자)·'category'(40자)·'document_date'(YYYY-MM-DD) 각각 하나까지.
     * 그 밖의 칸(mode·replace_document_id·source·description·tags 등)은 거절한다.
     */
    fun allowedParts(parts: List<WidgetPart>): Boolean {
        val by = parts.groupBy { it.name }
        if (!by.keys.all { it in PART_NAMES } || by.values.any { it.size != 1 }) return false
        val f = by["file"]?.single() ?: return false
        if (f.file == null || f.value != null || f.fileName.isNullOrEmpty()) return false
        val text = { name: String -> by[name]?.single() }
        if (parts.any { it.name != "file" && (it.file != null || it.value == null) }) return false
        if (!WidgetRules.isUserId(text("meeting_id")?.value)) return false
        text("project_id")?.let { if (!WidgetRules.isUserId(it.value)) return false }
        text("title")?.let { if (!plain(it.value, TITLE_MAX)) return false }
        text("category")?.let { if (!plain(it.value, CATEGORY_MAX)) return false }
        text("document_date")?.let { if (!DATE.matches(it.value ?: "")) return false }
        return true
    }

    private val PART_NAMES = setOf("file", "meeting_id", "project_id", "title", "category", "document_date")

    private fun plain(value: String?, max: Int): Boolean =
        value != null && value.isNotEmpty() && value.codePointCount(0, value.length) <= max && value.none { it.isISOControl() }

    // ── 한 개 올린 결과 ──

    sealed class One {
        data class Saved(val docId: String) : One()
        /** 위젯 로그인이 없거나 끝남. 남은 파일을 두고 멈춘다. */
        object SignedOut : One()
        /**
         * 실패. code는 영문 소문자 까닭 코드. retry면 그 파일을 그대로 두고 조금 뒤 다시(겹쳐 올라갈 걱정 없는 실패만).
         * whole이면 대상 자체가 안 되는 실패(권한 없음·사업 보고가 지워짐)라 남은 파일도 보내지 않는다.
         */
        data class Failed(val code: String, val retry: Boolean, val whole: Boolean = false) : One()
    }

    /**
     * 서버 답 → 한 개의 결과. 다시 보내도 되는 것은 서버가 retryable이라 답했거나(자료 기록 실패·Drive 일시 오류 등) 요청이 닿지 못한 것(429·503)뿐이다.
     * 그 밖의 5xx·408은 자료가 생겼는지 알 수 없어 다시 보내지 않는다(웹 올리기와 같은 규칙: 같은 파일을 저절로 다시 보내지 않는다).
     */
    fun result(status: Int, body: Any?): One {
        val map = MiniJson.obj(body)
        val code = MiniJson.str(map?.get("code")) ?: ""
        if (status == 200) {
            val id = MiniJson.str(MiniJson.obj(map?.get("document"))?.get("id"))
            return if (map?.get("ok") == true && WidgetRules.isUserId(id)) One.Saved(id!!.lowercase()) else One.Failed(UNKNOWN, false)
        }
        val retryable = map?.get("retryable") == true
        return when {
            status == 413 || code == "file_too_large" -> One.Failed(TOO_BIG, false)
            status == 404 && code == "meeting_not_found" -> One.Failed(GONE, false, whole = true)
            status == 403 -> One.Failed(FORBIDDEN, false, whole = true)
            status == 429 || status == 503 -> One.Failed(SERVER, true)
            retryable && (status == 408 || status in 500..599) -> One.Failed(SERVER, true)
            // 형식이 맞지 않는 요청은 서버가 retryable로 답해도 같은 파일을 다시 보내 봐야 같다.
            status in 400..499 && status != 408 -> One.Failed(REFUSED, false)
            else -> One.Failed(UNKNOWN, false)
        }
    }

    // ── 묶음 한 번 돌리기 ──

    sealed class Run {
        /** 남은 파일 없음. saved개 올림, failed개는 다시 안 될 실패로 끝냄(first = 첫 실패 까닭 코드). */
        data class Done(val saved: Int, val failed: Int, val total: Int, val first: String?, val photos: Boolean) : Run()
        /** 남은 파일을 두고 멈춤. retry면 조금 뒤 저절로 다시 해 볼 실패(인터넷·서버 일시 오류). */
        data class Stopped(val reason: String, val retry: Boolean, val left: Int, val total: Int) : Run()
    }

    /**
     * 남은 파일을 차례로 올린다. 한 개가 끝날 때마다(올림·다시 안 될 실패) 그 임시 파일을 지우고 결과를 적은 뒤 after를 부른다.
     * 파일끼리 서로 기대지 않으므로 한 개의 실패가 다른 파일을 막지 않는다. 다시 될 실패·로그인 풀림은 남은 파일을 두고 멈춘다.
     */
    fun run(store: BackUploadStore, batch: String, after: () -> Unit = {}, upload: (BackUploadStore.Item, Target) -> One): Run {
        val total = store.total(batch)
        val target = store.target(batch)
        val photos = store.photosOnly(batch)
        if (total <= 0 || target == null) {
            store.drop(batch)
            return Run.Done(0, 0, 0, null, photos)
        }
        // 목록에는 있는데 임시 파일도 결과도 없는 것(폰이 지움): 사라짐으로 적는다.
        store.missing(batch).forEach { store.finish(batch, it, null, MISSING) }
        var items = store.items(batch)
        while (items.isNotEmpty()) {
            val item = items.first()
            when (val r = upload(item, target)) {
                is One.Saved -> store.finish(batch, item.index, r.docId, null)
                One.SignedOut -> return Run.Stopped(SIGNED_OUT, false, items.size, total)
                is One.Failed -> when {
                    r.retry -> return Run.Stopped(r.code, true, items.size, total)
                    r.whole -> items.forEach { store.finish(batch, it.index, null, r.code) }
                    else -> store.finish(batch, item.index, null, r.code)
                }
            }
            after()
            items = store.items(batch)
        }
        val results = store.results(batch)
        return Run.Done(results.count { it.doc != null }, results.count { it.doc == null }, total, results.firstOrNull { it.doc == null }?.error, photos)
    }

    /** WorkManager가 저절로 다시 할지: 다시 될 실패이고 3번 안쪽(위젯 [사진]과 같음). runAttemptCount는 0부터. */
    fun autoRetry(run: Run.Stopped, attempts: Int): Boolean = run.retry && attempts < QuickPhotoRules.AUTO_RETRIES - 1

    // ── 다리 글 ──

    fun ackMessage(ok: Boolean, step: String, error: String = "", id: String? = null): String =
        "up:ack:{\"ok\":$ok,\"step\":" + ShellRules.jsonString(step.filter { it in 'a'..'z' }.take(10)) +
            ",\"error\":" + ShellRules.jsonString(error.filter { it in 'a'..'z' || it == '_' }.take(20)) +
            (if (id != null && QuickPhotoRules.isBatch(id)) ",\"id\":" + ShellRules.jsonString(id) else "") + "}"

    /** 묶음 하나의 지금 상태(JSON). 닫지 않은 묶음·대상을 읽지 못한 묶음은 null. 파일 이름은 싣지 않는다. */
    fun jobJson(store: BackUploadStore, batch: String): String? {
        val total = store.total(batch)
        val target = store.target(batch) ?: return null
        if (total <= 0) return null
        val left = store.items(batch).size
        val stop = store.stopped(batch)
        val state = if (left == 0) "done" else if (stop != null) "stopped" else "run"
        val results = store.results(batch).associateBy { it.index }
        val order = store.indexes(batch)
        val docs = order.joinToString(",") { ShellRules.jsonString(results[it]?.doc ?: "") }
        val errors = order.joinToString(",") { ShellRules.jsonString(results[it]?.error ?: "") }
        return "{\"id\":" + ShellRules.jsonString(batch) + ",\"kind\":" + ShellRules.jsonString(target.kind) +
            ",\"target\":" + ShellRules.jsonString(target.meeting) + ",\"total\":$total,\"left\":$left,\"state\":\"$state\"" +
            ",\"reason\":" + ShellRules.jsonString(if (state == "stopped") stop ?: "" else "") +
            ",\"docs\":[$docs],\"errors\":[$errors]}"
    }

    fun jobMessage(store: BackUploadStore, batch: String): String? = jobJson(store, batch)?.let { "up:job:$it" }

    /** up:hello 답. on = 위젯 로그인이 있어 뒤에서 올릴 수 있음. jobs = 닫은 묶음들(새 것부터 20개). */
    fun stateMessage(on: Boolean, store: BackUploadStore?): String {
        val jobs = store?.batches()?.take(JOBS_MAX)?.mapNotNull { jobJson(store, it) }.orEmpty()
        return "up:state:{\"v\":1,\"on\":$on,\"kinds\":[" + KINDS.joinToString(",") { ShellRules.jsonString(it) } + "],\"jobs\":[" + jobs.joinToString(",") + "]}"
    }

    fun isCode(value: String?): Boolean = value != null && CODE.matches(value)

    // ── 알림 한 줄(토스트). 실제 까닭을 쓴다: 인터넷 탓이 아닐 때 '인터넷' 문구를 쓰지 않는다. ──

    /** 까닭 코드(다리 글 errors·reason에도 그대로 싣는다). */
    const val NETWORK = "network"
    const val SERVER = "server"
    const val SIGNED_OUT = "signed_out"
    const val TOO_BIG = "too_big"
    const val FORBIDDEN = "forbidden"
    const val GONE = "gone"
    const val UNKNOWN = "unknown"
    const val REFUSED = "refused"
    const val MISSING = "missing"
    /** 앱 안에서 올리기를 잇지 못함(세션·저장소를 열지 못함). */
    const val INTERNAL = "internal"

    fun reasonText(code: String?): String = when (code) {
        NETWORK -> "인터넷이 끊겨 있어요"
        SERVER -> "서버가 잠시 답하지 않아요"
        SIGNED_OUT -> "위젯 로그인이 풀렸어요"
        TOO_BIG -> "파일이 너무 커요(100MB까지)"
        FORBIDDEN -> "올릴 권한을 확인하지 못했어요"
        GONE -> "사업 보고를 찾지 못했어요"
        UNKNOWN -> "올렸는지 확인하지 못했어요 · 사업 보고를 확인해 주세요"
        MISSING -> "임시 파일이 사라졌어요 · 다시 선택해 주세요"
        INTERNAL -> "앱이 올리기를 잇지 못했어요"
        else -> "서버가 받지 않았어요"
    }

    private fun counted(n: Int, photos: Boolean): String = if (photos) "사진 ${n}장" else "자료 ${n}개"

    /** 목적격 조사: '장' 뒤는 '을', '개' 뒤는 '를'. */
    private fun obj(photos: Boolean): String = if (photos) "을" else "를"

    fun doneText(run: Run.Done): String = when {
        run.failed <= 0 -> "사업 보고에 ${counted(run.saved, run.photos)}${obj(run.photos)} 올렸어요"
        run.saved <= 0 -> "사업 보고에 ${counted(run.total, run.photos)}${obj(run.photos)} 올리지 못했어요 · " + reasonText(run.first)
        else -> "사업 보고에 ${counted(run.total, run.photos)} 중 ${run.failed}${if (run.photos) "장" else "개"}${obj(run.photos)} 올리지 못했어요 · " + reasonText(run.first)
    }

    /** 멈춤 한 줄. 남은 파일은 앱을 열면 이어 올린다(로그인 풀림은 위젯 로그인부터). */
    fun stoppedText(run: Run.Stopped): String {
        val tail = if (run.reason == SIGNED_OUT) "위젯에서 로그인한 뒤 앱을 열면 이어 올려요" else "앱을 열면 남은 것부터 다시 올려요"
        return "사업 보고 올리기가 멈췄어요(${run.left}개 남음) · " + reasonText(run.reason) + " · " + tail
    }
}

/**
 * 뒤에서 올리기의 임시 파일 묶음(앱 전용 공간, 백업 제외 폴더 back-upload/). 묶음 폴더·목록·남은 파일·3일 정리는
 * 위젯 [사진]의 QuickPhotoStore를 그대로 쓰고, 여기에 대상·사진 칸(job)·결과(done)·멈춘 까닭(stop)을 더한다.
 * 올린 파일·다시 안 될 실패 파일은 바로 지운다. 끝난 묶음은 결과 기록만 남고 up:seen 또는 3일 뒤 지운다.
 * 안드로이드 API 없이 java.io만 써서 JVM 시험 대상이다.
 */
class BackUploadStore(private val root: File, private val now: () -> Long = System::currentTimeMillis) {
    data class Item(val index: Int, val name: String, val type: String, val file: File, val fields: BackUploadRules.Fields)
    data class Result(val index: Int, val doc: String?, val error: String?)

    private val files = QuickPhotoStore(root, now)

    private fun dir(batch: String): File {
        require(QuickPhotoRules.isBatch(batch))
        return File(root, batch)
    }

    /** 새 묶음(빈 폴더). */
    fun create(): String = files.create()

    private fun partFile(batch: String, index: Int): File = File(dir(batch), "$index.part")

    /** 한 개 받기 시작(받던 조각 파일이 있으면 비운다). */
    fun begin(batch: String, index: Int) {
        require(index >= 0)
        FileOutputStream(partFile(batch, index), false).close()
    }

    fun part(batch: String, index: Int, bytes: ByteArray) {
        val f = partFile(batch, index)
        if (!f.isFile) throw IOException("part")
        FileOutputStream(f, true).use { it.write(bytes) }
    }

    /** 다 받은 한 개를 제 이름(번호)으로 바꾼다. 크기가 선언과 다르면 지우고 false. */
    fun end(batch: String, index: Int, size: Long): Boolean {
        val f = partFile(batch, index)
        if (!f.isFile || f.length() != size || size <= 0L) {
            f.delete()
            return false
        }
        return f.renameTo(File(dir(batch), index.toString()))
    }

    /** 받던 조각을 버린다. */
    fun abort(batch: String, index: Int) {
        partFile(batch, index).delete()
    }

    /** 묶음을 닫는다: 대상·사진 칸(job)과 목록(meta)을 쓴다. 이것이 있어야 올릴 묶음이다. */
    fun seal(batch: String, target: BackUploadRules.Target, entries: List<BackUploadRules.Intake.Entry>) {
        require(entries.isNotEmpty())
        val one = { s: String? -> (s ?: "").replace(Regex("[\\t\\r\\n]"), " ") }
        val sb = StringBuilder("v1\n")
        sb.append(target.kind).append('\t').append(target.meeting).append('\t').append(target.project ?: "").append('\n')
        for (e in entries) sb.append(e.index).append('\t').append(one(e.fields.date)).append('\t').append(one(e.fields.category)).append('\t').append(one(e.fields.title)).append('\n')
        File(dir(batch), JOB).writeText(sb.toString())
        files.seal(batch, entries.map { Triple(it.index, it.mime, it.name) })
    }

    private fun job(batch: String): List<String>? {
        val f = File(dir(batch), JOB)
        if (!f.isFile) return null
        val lines = try {
            f.readLines()
        } catch (_: IOException) {
            return null
        }
        return if (lines.size >= 2 && lines[0] == "v1") lines else null
    }

    fun target(batch: String): BackUploadRules.Target? {
        val p = job(batch)?.get(1)?.split('\t') ?: return null
        if (p.size != 3 || p[0] != BackUploadRules.KIND_MEETING || !WidgetRules.isUserId(p[1])) return null
        if (p[2].isNotEmpty() && !WidgetRules.isUserId(p[2])) return null
        return BackUploadRules.Target(p[0], p[1], p[2].ifEmpty { null })
    }

    private fun fields(batch: String): Map<Int, BackUploadRules.Fields> =
        job(batch).orEmpty().drop(2).mapNotNull { line ->
            val p = line.split('\t', limit = 4)
            val i = p.getOrNull(0)?.toIntOrNull()
            if (p.size != 4 || i == null) null else i to BackUploadRules.Fields(p[3].ifEmpty { null }, p[2].ifEmpty { null }, p[1].ifEmpty { null })
        }.toMap()

    /** 이 묶음의 전체 개수(닫지 않았으면 0). */
    fun total(batch: String): Int = if (exists(batch)) files.total(batch) else 0

    /** 아직 끝내지 않은 파일(임시 파일이 남은 것), 번호 순. */
    fun items(batch: String): List<Item> {
        val fields = fields(batch)
        return files.items(batch).map { Item(it.index, it.name, it.type, it.file, fields[it.index] ?: BackUploadRules.Fields()) }
    }

    /** 목록의 번호들(번호 순). */
    fun indexes(batch: String): List<Int> = known(batch).filter { it in 0 until MAX_INDEX }.sorted()

    private fun known(batch: String): Set<Int> {
        val f = File(dir(batch), "meta")
        val lines = try {
            if (f.isFile) f.readLines() else emptyList()
        } catch (_: IOException) {
            emptyList()
        }
        return lines.drop(2).mapNotNull { it.split('\t', limit = 3).getOrNull(0)?.toIntOrNull() }.toSet()
    }

    /** 사진만 든 묶음인지(알림 문구용). */
    fun photosOnly(batch: String): Boolean {
        val f = File(dir(batch), "meta")
        val types = try {
            if (f.isFile) f.readLines().drop(2).mapNotNull { it.split('\t', limit = 3).getOrNull(1) } else emptyList()
        } catch (_: IOException) {
            emptyList()
        }
        return types.isNotEmpty() && types.all { it.startsWith("image/") }
    }

    /** 한 개를 끝낸다: 결과(자료 id 또는 까닭 코드)를 적고 임시 파일을 지운다. 이미 적은 번호는 다시 적지 않는다. */
    fun finish(batch: String, index: Int, doc: String?, error: String?) {
        require(doc == null || WidgetRules.isUserId(doc))
        require(doc != null || BackUploadRules.isCode(error))
        if (results(batch).none { it.index == index }) {
            FileOutputStream(File(dir(batch), DONE), true).use { it.write("$index\t${doc ?: ""}\t${if (doc == null) error else ""}\n".toByteArray()) }
        }
        File(dir(batch), index.toString()).delete()
    }

    fun results(batch: String): List<Result> {
        val f = File(dir(batch), DONE)
        val lines = try {
            if (f.isFile) f.readLines() else emptyList()
        } catch (_: IOException) {
            emptyList()
        }
        return lines.mapNotNull { line ->
            val p = line.split('\t')
            val i = p.getOrNull(0)?.toIntOrNull()
            if (p.size != 3 || i == null) return@mapNotNull null
            val doc = p[1].takeIf { WidgetRules.isUserId(it) }
            val error = if (doc == null) p[2].takeIf { BackUploadRules.isCode(it) } ?: BackUploadRules.UNKNOWN else null
            Result(i, doc, error)
        }.distinctBy { it.index }
    }

    /** 목록에는 있는데 임시 파일도 결과도 없는 번호(폰이 임시 파일을 지운 경우). */
    fun missing(batch: String): List<Int> {
        val left = files.items(batch).map { it.index }.toSet()
        val done = results(batch).map { it.index }.toSet()
        return indexes(batch).filter { it !in left && it !in done }
    }

    /** 멈춘 까닭 코드를 적거나(다시 걸면 null로) 지운다. */
    fun stop(batch: String, reason: String?) {
        val f = File(dir(batch), STOP)
        if (reason == null) f.delete() else {
            require(BackUploadRules.isCode(reason))
            f.writeText(reason)
        }
    }

    fun stopped(batch: String): String? {
        val f = File(dir(batch), STOP)
        return try {
            if (f.isFile) f.readText().trim().takeIf { BackUploadRules.isCode(it) } else null
        } catch (_: IOException) {
            null
        }
    }

    fun exists(batch: String): Boolean = dir(batch).isDirectory

    /** 닫은 묶음들(새 것부터). 받는 중인 묶음(목록 없음)은 뺀다. */
    fun batches(): List<String> =
        root.listFiles().orEmpty().filter { it.isDirectory && QuickPhotoRules.isBatch(it.name) && File(it, "meta").isFile }
            .sortedByDescending { File(it, "meta").lastModified() }.map { it.name }

    /** 닫았고 아직 끝내지 않은 파일이 남은 묶음. */
    fun pending(): List<String> = files.pending()

    fun drop(batch: String) = files.drop(batch)

    /** 끝난 묶음(남은 파일 없음)만 지운다. 올리는 중인 묶음은 두고 false. */
    fun seen(batch: String): Boolean {
        if (!exists(batch) || total(batch) <= 0 || files.items(batch).isNotEmpty()) return false
        drop(batch)
        return true
    }

    /**
     * 정리: 3일 지난 묶음과, 닫지 않은 채 남은 묶음(받다가 화면이 닫힘), 묶음이 아닌 것을 지운다. keep은 지금 받는 중인 묶음(건드리지 않는다).
     * 받는 중인 묶음은 한 번에 하나뿐이라 그 밖의 닫지 않은 묶음은 쓰레기다. 지운 수.
     */
    fun sweep(keep: String?): Int {
        var n = 0
        for (d in root.listFiles().orEmpty()) {
            if (keep != null && d.name == keep) continue
            val at = if (d.isDirectory && QuickPhotoRules.isBatch(d.name)) sealedAt(d) else null
            val age = if (at == null) null else now() - at
            if (age == null || age > QuickPhotoRules.STALE_MS || age < -QuickPhotoRules.STALE_MS) {
                d.deleteRecursively()
                n++
            }
        }
        return n
    }

    /** 묶음을 닫은 시각(목록 파일 둘째 줄). 닫지 않았거나 읽지 못하면 null. */
    private fun sealedAt(d: File): Long? {
        val f = File(d, "meta")
        return try {
            if (f.isFile) f.readLines().takeIf { it.size >= 2 && it[0] == "v1" }?.get(1)?.toLongOrNull() else null
        } catch (_: IOException) {
            null
        }
    }

    private companion object {
        const val JOB = "job"
        const val DONE = "done"
        const val STOP = "stop"
        const val MAX_INDEX = BackUploadRules.MAX_FILES
    }
}
