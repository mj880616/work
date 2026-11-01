package kr.or.kptu.work

/**
 * PHOTO-갤러리편집(요청함 11/01 19:00, A안): 사진 크게 보기 [편집] → 삼성 갤러리 편집기(없으면 안드로이드 '편집할 앱 고르기').
 * 안드로이드 API 없이 JVM 단위 시험으로 고정하는 규칙만 둔다(의도는 MainActivity가 이 계획대로 만든다).
 *
 * 다리(KPTUAppShell, 허용 Origin 최상위 화면만):
 * - photos:edit:{"id":"123"}                         폰 사진 번호로 편집
 * - photos:edit:{"name":"a.jpg","size":1,"taken":ms} 원드라이브·구글 드라이브 사진: 같은 사진이 폰에 있으면 그것을 편집, 없으면 none
 *   → photos:edited:{"ok":bool,"changed":bool,"error":"none|old|busy|failed|noapp"}
 * - photos:save:begin:{"name","mime","size"} / photos:save:part:<base64> / photos:save:end / photos:save:cancel
 *   = 폰에 없는 사진의 원본(웹이 기존 '원본 받기' 길로 받은 바이트)을 Pictures/웹2에 한 장 저장 → photos:save:{"ok","step","got","id","error"}
 * 넘기는 것은 content URI(+읽기·쓰기 허락 표시)뿐, 파일 경로는 앱 밖으로 내보내지 않는다. 사진 이름·내용은 로그에 쓰지 않는다.
 */
object PhotoEditRules {
    /** 삼성 갤러리(편집기). 설치돼 있고 ACTION_EDIT를 받으면 바로 그 앱으로, 아니면 고르기 창. */
    const val SAMSUNG_GALLERY = "com.sec.android.gallery3d"
    const val ACTION_EDIT = "android.intent.action.EDIT"
    /** Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION (값은 안드로이드 공개 상수와 같다). */
    const val GRANT_READ = 0x00000001
    const val GRANT_WRITE = 0x00000002
    const val GRANT_FLAGS = GRANT_READ or GRANT_WRITE

    const val SAVE_DIR = "Pictures/웹2/"
    const val SAVE_MAX = 60L * 1024 * 1024
    /** 한 조각(base64 글자 수). 웹은 384KB 바이트씩 보낸다(base64 512KB). */
    const val PART_MAX = 700_000
    const val NAME_MAX = 120
    const val SAME_MS = 2000L

    sealed class Target {
        data class Id(val id: Long) : Target()
        data class Match(val name: String, val size: Long, val takenMs: Long) : Target()
    }

    sealed class Message {
        data class Edit(val target: Target) : Message()
        data class Begin(val name: String, val mime: String, val size: Long) : Message()
        data class Part(val base64: String) : Message()
        object End : Message()
        object Cancel : Message()
    }

    private val NUMBER = Regex("^[0-9]{1,18}$")
    private val B64 = Regex("^[A-Za-z0-9+/]*={0,2}$")

    fun message(data: String?): Message? {
        if (data == null || data.length > PART_MAX + 40) return null
        return when {
            data.startsWith("photos:edit:") -> target(data.substring("photos:edit:".length))?.let { Message.Edit(it) }
            data.startsWith("photos:save:begin:") -> begin(data.substring("photos:save:begin:".length))
            data.startsWith("photos:save:part:") -> data.substring("photos:save:part:".length)
                .takeIf { it.isNotEmpty() && it.length <= PART_MAX && it.length % 4 == 0 && B64.matches(it) }?.let { Message.Part(it) }
            data == "photos:save:end" -> Message.End
            data == "photos:save:cancel" -> Message.Cancel
            else -> null
        }
    }

    fun target(raw: String): Target? {
        if (raw.length > 2000) return null
        val o = try { MiniJson.obj(MiniJson.parse(raw)) } catch (_: Exception) { null } ?: return null
        MiniJson.str(o["id"])?.let { return if (NUMBER.matches(it)) Target.Id(it.toLong()) else null }
        val name = MiniJson.str(o["name"]) ?: ""
        val size = MiniJson.num(o["size"])?.takeIf { it >= 0 && it <= 1e15 && it == Math.floor(it) }?.toLong() ?: -1L
        val taken = MiniJson.num(o["taken"])?.takeIf { it > 0 && it <= 1e15 }?.toLong() ?: 0L
        if (name.length > 255 || name.any { it.isISOControl() }) return null
        if (name.isBlank() && size <= 0) return null
        return Target.Match(name.trim(), size, taken)
    }

    private fun begin(raw: String): Message.Begin? {
        if (raw.length > 2000) return null
        val o = try { MiniJson.obj(MiniJson.parse(raw)) } catch (_: Exception) { null } ?: return null
        val mime = MiniJson.str(o["mime"])?.lowercase() ?: return null
        val size = MiniJson.num(o["size"])?.takeIf { it == Math.floor(it) }?.toLong() ?: return null
        if (mime !in MIMES || size !in 1..SAVE_MAX) return null
        return Message.Begin(fileName(MiniJson.str(o["name"]), mime), mime, size)
    }

    /** 받는 그림 종류(편집기가 여는 사진만). 동영상은 받지 않는다. */
    val MIMES = mapOf("image/jpeg" to "jpg", "image/png" to "png", "image/webp" to "webp", "image/heic" to "heic", "image/heif" to "heif", "image/gif" to "gif")

    /** 저장 이름: 경로·제어 글자·앞 '.' 없이, 120자 안, 확장자를 그림 종류에 맞춘다. 비면 'web2-photo'. */
    fun fileName(raw: String?, mime: String): String {
        val ext = MIMES[mime] ?: "jpg"
        var base = (raw ?: "").substringAfterLast('/').substringAfterLast('\\')
            .filter { !it.isISOControl() && it !in "<>:\"|?*" }.trim().trimStart('.')
        val dot = base.lastIndexOf('.')
        if (dot > 0) base = base.substring(0, dot)
        base = base.trim().take(NAME_MAX - ext.length - 1).trim()
        if (base.isEmpty()) base = "web2-photo"
        return "$base.$ext"
    }

    /** 같은 사진인가(웹 photo-sources-model.mjs sameMedia와 같은 판정): 이름이 같고 크기나 찍은 시각(2초 안)이 같거나, 크기가 같고 시각이 2초 안. */
    fun same(m: PhoneMediaRules.Media, t: Target.Match): Boolean {
        if (m.video) return false
        val close = t.takenMs > 0 && m.takenMs > 0 && kotlin.math.abs(m.takenMs - t.takenMs) <= SAME_MS
        val sizeEq = t.size > 0 && m.size == t.size
        val nameEq = t.name.isNotEmpty() && t.name.equals(m.name, ignoreCase = true)
        return (nameEq && (sizeEq || close)) || (sizeEq && close)
    }

    /** 편집할 폰 사진(동영상 빼고). 같은 사진이 여럿이면 크기·이름이 모두 맞는 것, 그다음 최근 것. */
    fun pick(list: List<PhoneMediaRules.Media>, t: Target): PhoneMediaRules.Media? = when (t) {
        is Target.Id -> list.firstOrNull { it.id == t.id && !it.video }
        is Target.Match -> list.filter { same(it, t) }
            .sortedWith(compareByDescending<PhoneMediaRules.Media> { t.size > 0 && it.size == t.size && it.name.equals(t.name, true) }.thenByDescending { it.takenMs })
            .firstOrNull()
    }

    /**
     * 의도 계획: 삼성 갤러리가 받으면 그 앱으로(pkg), 아니면 고르기 창(chooser=true). content URI만(파일 경로 안 됨).
     * 허락 표시는 읽기·쓰기. 다만 안드로이드는 앱이 가진 만큼만 넘기게 하므로, 이 앱이 쓰기 권한이 없는 사진(남이 만든 사진,
     * '미디어 관리 허용' 꺼짐)이면 읽기만 넘긴다(갤러리는 제 권한으로 저장한다). canWrite=false 재시도도 같은 규칙.
     */
    data class Plan(val action: String, val uri: String, val mime: String, val flags: Int, val pkg: String?, val chooser: Boolean)

    fun plan(uri: String, mime: String, samsungCanEdit: Boolean, canWrite: Boolean = true): Plan? {
        if (!uri.startsWith("content://")) return null
        val type = if (mime.startsWith("image/")) mime else "image/*"
        return Plan(ACTION_EDIT, uri, type, if (canWrite) GRANT_FLAGS else GRANT_READ, if (samsungCanEdit) SAMSUNG_GALLERY else null, !samsungCanEdit)
    }

    /** 편집기에서 돌아온 뒤: 사진첩 세대 번호가 바뀌었으면 changed(새 사진·덮어쓰기). 번호를 못 읽으면(-1) 바뀐 것으로 본다. */
    fun changed(before: Long, after: Long): Boolean = before < 0 || after < 0 || before != after

    fun editedMessage(ok: Boolean, changed: Boolean = false, error: String = ""): String =
        "photos:edited:{\"ok\":$ok,\"changed\":$changed,\"error\":" + ShellRules.jsonString(error.filter { it in 'a'..'z' }.take(20)) + "}"

    fun saveMessage(ok: Boolean, step: String, got: Long = 0, id: Long? = null, error: String = ""): String {
        val sb = StringBuilder("photos:save:{\"ok\":").append(ok)
        sb.append(",\"step\":").append(ShellRules.jsonString(step.filter { it in 'a'..'z' }.take(10)))
        sb.append(",\"got\":").append(got)
        if (id != null) sb.append(",\"id\":").append(ShellRules.jsonString(id.toString()))
        sb.append(",\"error\":").append(ShellRules.jsonString(error.filter { it in 'a'..'z' }.take(20)))
        return sb.append('}').toString()
    }

    /** 받는 중인 한 장: 선언한 크기를 넘으면 실패, 끝에 크기가 맞아야 완료. */
    class Saving(val size: Long) {
        var got = 0L
            private set
        fun add(n: Int): Boolean {
            if (n <= 0 || got + n > size) return false
            got += n
            return true
        }
        val complete: Boolean get() = got == size
    }
}
