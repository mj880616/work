package kr.or.kptu.work

/**
 * PHOTO-폰앱공유(요청함 11/01 21:26, 0.4.7): 웹2 화면의 [공유] → 안드로이드 공유 창(ACTION_SEND·ACTION_SEND_MULTIPLE).
 * 폰 앱 화면(WebView)에는 navigator.share가 없어 웹(app/app-share.js)이 이 다리로 넘긴다. 안드로이드 API 없이 JVM 시험으로 고정하는 규칙만 둔다.
 *
 * 다리(KPTUAppShell, 허용 Origin 최상위 화면만):
 * - out:hello                               → out:state:{"v":1}        (이 판이 공유 창 길을 안다)
 * - out:start:{"count":n}                   → out:ack:{"ok","step":"start","error"}  한 번 공유할 묶음 시작(앞 묶음은 버림)
 * - out:phone:<번호>                        → out:ack step phone       폰 사진·동영상: 그 사진 파일 그대로(MediaStore content URI)
 * - out:begin:{"name","mime","size"}        → out:ack step begin       원드라이브·구글 드라이브: 웹이 이미 받은 그림 바이트
 *   out:part:<base64> → step part, out:end → step end                   (앱 캐시 share-out/에 한 장씩, FileProvider content URI로만 넘김)
 * - out:go                                  → out:sent:{"ok","error"}  공유 창을 띄웠음(ok) 또는 none·noapp·failed
 * - out:cancel                                                          받다 만 묶음 버림
 * 파일 경로는 앱 밖으로 내보내지 않는다(content URI + 읽기 허락만). 사진 이름·내용은 로그에 쓰지 않는다.
 */
object ShareOutRules {
    const val MAX_FILES = 20
    const val FILE_MAX = 60L * 1024 * 1024
    const val TOTAL_MAX = 200L * 1024 * 1024
    /** 한 조각(base64 글자 수). 웹은 384KB 바이트씩 보낸다(base64 512KB). */
    const val PART_MAX = 700_000
    const val STATE = "out:state:{\"v\":1}"
    const val SEND = "android.intent.action.SEND"
    const val SEND_MULTIPLE = "android.intent.action.SEND_MULTIPLE"

    sealed class Message {
        object Hello : Message()
        data class Start(val count: Int) : Message()
        data class Phone(val id: Long) : Message()
        data class Begin(val name: String, val mime: String, val size: Long) : Message()
        data class Part(val base64: String) : Message()
        object End : Message()
        object Go : Message()
        object Cancel : Message()
    }

    private val NUMBER = Regex("^[0-9]{1,18}$")
    private val B64 = Regex("^[A-Za-z0-9+/]*={0,2}$")

    fun message(data: String?): Message? {
        if (data == null || data.length > PART_MAX + 40) return null
        return when {
            data == "out:hello" -> Message.Hello
            data.startsWith("out:start:") -> start(data.substring("out:start:".length))
            data.startsWith("out:phone:") -> data.substring("out:phone:".length).takeIf { NUMBER.matches(it) }?.let { Message.Phone(it.toLong()) }
            data.startsWith("out:begin:") -> begin(data.substring("out:begin:".length))
            data.startsWith("out:part:") -> data.substring("out:part:".length)
                .takeIf { it.isNotEmpty() && it.length <= PART_MAX && it.length % 4 == 0 && B64.matches(it) }?.let { Message.Part(it) }
            data == "out:end" -> Message.End
            data == "out:go" -> Message.Go
            data == "out:cancel" -> Message.Cancel
            else -> null
        }
    }

    private fun start(raw: String): Message.Start? {
        if (raw.length > 200) return null
        val o = try { MiniJson.obj(MiniJson.parse(raw)) } catch (_: Exception) { null } ?: return null
        val n = MiniJson.num(o["count"])?.takeIf { it == Math.floor(it) }?.toInt() ?: return null
        return if (n in 1..MAX_FILES) Message.Start(n) else null
    }

    private fun begin(raw: String): Message.Begin? {
        if (raw.length > 2000) return null
        val o = try { MiniJson.obj(MiniJson.parse(raw)) } catch (_: Exception) { null } ?: return null
        val mime = MiniJson.str(o["mime"])?.lowercase() ?: return null
        val size = MiniJson.num(o["size"])?.takeIf { it == Math.floor(it) }?.toLong() ?: return null
        if (mime !in PhotoEditRules.MIMES || size !in 1..FILE_MAX) return null
        return Message.Begin(PhotoEditRules.fileName(MiniJson.str(o["name"]), mime), mime, size)
    }

    /** 공유 창 의도: 한 장이면 SEND, 여러 장이면 SEND_MULTIPLE. 종류는 모두 같으면 그것, 모두 그림이면 image/*, 모두 동영상이면 video/*, 섞이면 * / *. */
    data class Plan(val action: String, val mime: String)

    fun plan(mimes: List<String>): Plan? {
        val list = mimes.map { it.lowercase().ifBlank { "application/octet-stream" } }
        if (list.isEmpty() || list.size > MAX_FILES) return null
        val mime = when {
            list.distinct().size == 1 -> list[0]
            list.all { it.startsWith("image/") } -> "image/*"
            list.all { it.startsWith("video/") } -> "video/*"
            else -> "*/*"
        }
        return Plan(if (list.size == 1) SEND else SEND_MULTIPLE, mime)
    }

    /** 한 번 공유할 묶음: 시작할 때 선언한 장 수까지, 한 장 60MB·합계 200MB까지, 받는 중인 한 장은 선언한 크기를 넘지 못한다. */
    class Batch(val count: Int) {
        var added = 0
            private set
        var total = 0L
            private set
        var current: PhotoEditRules.Saving? = null
            private set

        fun canAdd(): Boolean = current == null && added < count

        fun addPhone(): Boolean {
            if (!canAdd()) return false
            added++
            return true
        }

        fun begin(size: Long): Boolean {
            if (!canAdd() || size !in 1..FILE_MAX || total + size > TOTAL_MAX) return false
            current = PhotoEditRules.Saving(size)
            return true
        }

        fun part(n: Int): Boolean = current?.add(n) == true

        /** 받는 중인 한 장 끝. 크기가 맞아야 그 장을 센다. */
        fun end(): Boolean {
            val s = current ?: return false
            current = null
            if (!s.complete) return false
            added++
            total += s.size
            return true
        }

        val ready: Boolean get() = current == null && added == count
    }

    fun ackMessage(ok: Boolean, step: String, error: String = ""): String =
        "out:ack:{\"ok\":$ok,\"step\":" + ShellRules.jsonString(step.filter { it in 'a'..'z' }.take(10)) +
            ",\"error\":" + ShellRules.jsonString(error.filter { it in 'a'..'z' }.take(20)) + "}"

    fun sentMessage(ok: Boolean, error: String = ""): String =
        "out:sent:{\"ok\":$ok,\"error\":" + ShellRules.jsonString(error.filter { it in 'a'..'z' }.take(20)) + "}"
}
