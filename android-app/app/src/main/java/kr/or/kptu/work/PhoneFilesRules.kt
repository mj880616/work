package kr.or.kptu.work

import java.io.File
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest

/**
 * FILES-통합 3단계(S49-51, 설계 docs/design/files-unified-plan.md J절 H-1): [파일]의 '이 폰' 저장 공간 다리 규칙. 안드로이드 API 없이 JVM 시험으로 고정한다.
 * - 명진 결정 H-1: 폰 전체 저장 공간('모든 파일 접근', MANAGE_EXTERNAL_STORAGE)을 쓴다. 대신 다리 안전장치를 두껍게:
 *   ① 사진 다리(PhoneMediaRules)와 같은 열쇠·Origin·https·허용 호스트·GET 검사(열쇠는 이 다리 몫으로 따로), ② 쓰기는 사람이 누른 것만(이 판은 읽기만),
 *   ③ Android/data·Android/obb·숨김(점으로 시작) 칸은 다리에서 막는다(목록에서도 빠짐), 경로는 '내부 저장소 뿌리' 안만(../·빈 칸·역슬래시·제어 글자 거절,
 *   바로 가기(심볼릭 링크)로 뿌리 밖이나 막힌 곳을 가리키면 거절), ④ 로그에 파일 이름·경로·목록을 남기지 않고 서버로 보내지 않는다.
 * - 웹(app/phone-files.js)은 다리(KPTUAppShell)에 'pfiles:hello'를 보내 {all, key}를 받고, 목록·원본·작은 그림은
 *   https://<허용 호스트>/work/app/__phone/<열쇠>/files/{list|recent|raw|thumb}?… 를 fetch한다. 앱이 가로채 폰 안에서 답한다.
 * - 'pfiles:ask' = 안드로이드 설정 '모든 파일 접근 허용' 화면(명진이 한 번 켬). 돌아오면 상태를 다시 알린다.
 */
object PhoneFilesRules {
    /** 경로 한 칸·전체 길이 한도. */
    const val SEG_MAX = 255
    const val PATH_MAX = 1024
    const val DEPTH_MAX = 40
    /** 한 폴더 목록 줄 한도(넘으면 more=true). */
    const val LIST_MAX = 3000
    /** [최근] 줄 한도. */
    const val RECENT_MAX = 300
    const val RECENT_DEFAULT = 200
    const val THUMB_SMALL = 320
    const val THUMB_LARGE = 1600

    sealed class Request {
        /** dir = 뿌리에서의 상대 경로(빈 글 = 뿌리). */
        data class List(val dir: String) : Request()
        data class Recent(val limit: Int) : Request()
        data class Raw(val path: String) : Request()
        data class Thumb(val path: String, val large: Boolean) : Request()
        object Bad : Request()
        object WrongKey : Request()
    }

    enum class Fail(val code: String, val status: Int) {
        PERMISSION("permission", 403),
        KEY("key", 403),
        BAD_REQUEST("bad_request", 400),
        BLOCKED("blocked", 403),
        NOT_FOUND("not_found", 404),
        READ("read", 500),
    }

    private val PATH = Regex("^(?:/work/app)?/__phone/([A-Za-z0-9_-]{22,64})/files/(list|recent|raw|thumb)$")
    private val KEY = Regex("^[A-Za-z0-9_-]{22,64}$")

    fun isKey(value: String?): Boolean = value != null && KEY.matches(value)

    /**
     * 가로챌 주소인가. __phone/…/files/ 주소가 아니면 null(사진 다리·평소 길로), 모양이 틀리면 Bad, 열쇠가 틀리면 WrongKey.
     * https·허용 호스트·기본 포트·사용자 정보 없음·조각(#) 없음·GET만. 사진 다리와 같은 문.
     */
    fun request(url: String?, method: String?, key: String): Request? {
        val u = try {
            if (url == null) null else URI(url)
        } catch (_: Exception) {
            null
        } ?: return null
        val path = u.rawPath ?: return null
        if (!path.contains("/__phone/") || !path.contains("/files/")) return null
        if (!Regex("/__phone/[^/]+/files/").containsMatchIn(path)) return null
        if (!"https".equals(u.scheme, ignoreCase = true) || u.rawUserInfo != null) return Request.Bad
        if (u.port != -1 && u.port != 443) return Request.Bad
        if ((u.host?.lowercase() ?: "") !in ShellRules.INTERNAL_HOSTS) return Request.Bad
        if (!"GET".equals(method, ignoreCase = true) || u.rawFragment != null) return Request.Bad
        val m = PATH.matchEntire(path) ?: return Request.Bad
        if (!isKey(key) || !sameKey(m.groupValues[1], key)) return Request.WrongKey
        val q = query(u.rawQuery) ?: return Request.Bad
        return when (m.groupValues[2]) {
            "list" -> {
                if (q.keys.any { it != "dir" }) return Request.Bad
                val dir = q["dir"] ?: ""
                if (dir.isNotEmpty() && segments(dir) == null) return Request.Bad
                Request.List(dir)
            }
            "recent" -> {
                if (q.keys.any { it != "limit" }) return Request.Bad
                val limit = q["limit"]?.let { if (Regex("^[0-9]{1,4}$").matches(it)) it.toInt() else return Request.Bad } ?: RECENT_DEFAULT
                if (limit !in 1..RECENT_MAX) return Request.Bad
                Request.Recent(limit)
            }
            "raw" -> {
                if (q.keys.any { it != "path" }) return Request.Bad
                val p = q["path"] ?: return Request.Bad
                if (segments(p) == null) return Request.Bad
                Request.Raw(p)
            }
            else -> {
                if (q.keys.any { it != "path" && it != "s" }) return Request.Bad
                val p = q["path"] ?: return Request.Bad
                val s = q["s"] ?: "small"
                if (segments(p) == null || (s != "small" && s != "large")) return Request.Bad
                Request.Thumb(p, s == "large")
            }
        }
    }

    /**
     * 상대 경로 → 칸 목록. 빈 칸·'.'·'..'·역슬래시·제어 글자·NUL, 칸 255자·전체 1024자·40단계 넘음, 맨 앞·뒤 '/'는 null.
     * 숨김 칸(점으로 시작)과 막힌 곳(Android/data·Android/obb)도 null — 다리로는 닿지 않는다.
     */
    fun segments(rel: String): kotlin.collections.List<String>? {
        if (rel.isEmpty() || rel.length > PATH_MAX) return null
        if (rel.startsWith("/") || rel.endsWith("/")) return null
        val segs = rel.split('/')
        if (segs.size > DEPTH_MAX) return null
        for (s in segs) {
            if (!segmentOk(s)) return null
        }
        if (blocked(segs)) return null
        return segs
    }

    fun segmentOk(s: String): Boolean =
        s.isNotEmpty() && s.length <= SEG_MAX && s != "." && s != ".." && !s.startsWith(".") &&
            s.none { it == '\\' || it == '\u0000' || it.isISOControl() }

    /** Android/data·Android/obb(와 그 안)는 막는다. 대소문자 구분 없이. */
    fun blocked(segs: kotlin.collections.List<String>): Boolean =
        segs.size >= 2 && segs[0].equals("Android", ignoreCase = true) && (segs[1].equals("data", ignoreCase = true) || segs[1].equals("obb", ignoreCase = true))

    /** 목록에 보일 한 칸인가: 숨김·막힌 곳 빼기. parent = 그 폴더의 칸 목록(뿌리면 빈 목록). */
    fun visibleChild(parent: kotlin.collections.List<String>, name: String): Boolean = segmentOk(name) && !blocked(parent + name)

    /**
     * 상대 경로 → 실제 파일. 뿌리(root) 안이고 막힌 곳이 아닐 때만. 바로 가기를 따라간 실제 위치(canonical)도 다시 본다.
     * dir=true면 빈 글(뿌리)도 받는다.
     */
    fun resolve(root: File, rel: String, dir: Boolean = false): File? {
        val base = try { root.canonicalFile } catch (_: Exception) { return null }
        if (rel.isEmpty()) return if (dir) base else null
        val segs = segments(rel) ?: return null
        val f = try { File(base, segs.joinToString(File.separator)).canonicalFile } catch (_: Exception) { return null }
        val real = relOf(base, f) ?: return null
        if (real.isEmpty()) return if (dir) f else null
        val realSegs = real.split('/')
        if (blocked(realSegs) || realSegs.any { it.startsWith(".") }) return null
        return f
    }

    /** 뿌리(canonical) 기준 상대 경로. 뿌리 밖이면 null, 뿌리 자체면 빈 글. */
    fun relOf(base: File, f: File): String? {
        val b = base.path.trimEnd(File.separatorChar)
        val p = f.path
        if (p == b) return ""
        if (!p.startsWith(b + File.separator)) return null
        return p.substring(b.length + 1).replace(File.separatorChar, '/')
    }

    /** 확장자 → 종류(화면 미리보기·받는 쪽 Content-Type). 모르는 것은 application/octet-stream. */
    fun mimeOf(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase()
        return MIMES[ext] ?: "application/octet-stream"
    }

    private val MIMES = mapOf(
        "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "png" to "image/png", "gif" to "image/gif", "webp" to "image/webp",
        "heic" to "image/heic", "heif" to "image/heif", "bmp" to "image/bmp",
        "mp4" to "video/mp4", "mov" to "video/quicktime", "3gp" to "video/3gpp", "webm" to "video/webm", "mkv" to "video/x-matroska",
        "mp3" to "audio/mpeg", "m4a" to "audio/mp4", "wav" to "audio/wav", "ogg" to "audio/ogg", "amr" to "audio/amr",
        "pdf" to "application/pdf", "txt" to "text/plain", "md" to "text/markdown", "csv" to "text/csv", "json" to "application/json",
        "hwp" to "application/x-hwp", "hwpx" to "application/hwp+zip",
        "doc" to "application/msword", "docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" to "application/vnd.ms-excel", "xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" to "application/vnd.ms-powerpoint", "pptx" to "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "zip" to "application/zip",
    )

    fun isImage(mime: String) = mime.startsWith("image/")
    fun isVideo(mime: String) = mime.startsWith("video/")

    /** 목록 한 줄. path = 뿌리 기준 상대 경로(폴더 안 목록에서는 이름만으로도 되지만 [최근]과 모양을 같게). */
    data class Entry(val path: String, val name: String, val dir: Boolean, val size: Long, val modifiedMs: Long, val mime: String)

    /** 폴더 먼저, 그다음 이름 순(대소문자 무시). 화면이 다시 정렬하지만 처음 그림이 흔들리지 않게. */
    fun sortEntries(list: kotlin.collections.List<Entry>): kotlin.collections.List<Entry> =
        list.sortedWith(compareBy<Entry>({ !it.dir }, { it.name.lowercase() }, { it.name }))

    fun entryJson(e: Entry): String = buildString {
        append("{\"p\":").append(ShellRules.jsonString(e.path))
        append(",\"n\":").append(ShellRules.jsonString(e.name))
        append(",\"d\":").append(e.dir)
        append(",\"s\":").append(if (e.dir) 0 else maxOf(0L, e.size))
        append(",\"m\":").append(maxOf(0L, e.modifiedMs))
        if (!e.dir) append(",\"t\":").append(ShellRules.jsonString(e.mime))
        append('}')
    }

    fun listJson(dir: String, entries: kotlin.collections.List<Entry>): String {
        val sorted = sortEntries(entries)
        val shown = sorted.take(LIST_MAX)
        return "{\"dir\":" + ShellRules.jsonString(dir) + ",\"items\":[" + shown.joinToString(",", transform = ::entryJson) + "],\"more\":" + (sorted.size > LIST_MAX) + "}"
    }

    /** [최근]: 파일만, 바뀐 시각 새것부터, 숨김·막힌 곳 빼고 limit까지. */
    fun recentJson(entries: kotlin.collections.List<Entry>, limit: Int): String {
        val list = entries.filter { !it.dir && segments(it.path) != null }
            .sortedWith(compareByDescending<Entry> { it.modifiedMs }.thenBy { it.path })
            .take(limit)
        return "{\"items\":[" + list.joinToString(",", transform = ::entryJson) + "]}"
    }

    /** MediaStore relative_path('Download/' 등) + 이름 → 상대 경로. 모양이 이상하면 null. */
    fun joinRel(relativePath: String?, name: String?): String? {
        val n = name ?: return null
        val dir = (relativePath ?: "").trim('/')
        val p = if (dir.isEmpty()) n else "$dir/$n"
        return if (segments(p) != null) p else null
    }

    fun failJson(f: Fail): String = "{\"error\":\"" + f.code + "\"}"

    fun reasonPhrase(status: Int): String = when (status) {
        400 -> "Bad Request"
        403 -> "Forbidden"
        404 -> "Not Found"
        else -> "Internal Server Error"
    }

    // ── 다리 글 ──

    sealed class Message {
        object Hello : Message()
        object Ask : Message()
    }

    fun message(data: String?): Message? = when (data) {
        "pfiles:hello" -> Message.Hello
        "pfiles:ask" -> Message.Ask
        else -> null
    }

    /**
     * 지금 상태. all = '모든 파일 접근'이 켜짐(안드로이드 11+). can = 이 폰에서 켤 수 있음(11+).
     * 열쇠는 켜져 있을 때만 준다. v = 다리 판(화면이 아는 것만 쓰게).
     */
    fun stateMessage(all: Boolean, can: Boolean, key: String): String {
        // v2(3-③): write = 받기·새 폴더·이름·휴지통(pfiles:op·pfiles:save)을 안다.
        val sb = StringBuilder("pfiles:state:{\"v\":2,\"write\":true,\"can\":").append(can).append(",\"all\":").append(all && can)
        if (all && can) sb.append(",\"key\":").append(ShellRules.jsonString(key))
        return sb.append('}').toString()
    }

    // ── 쓰기(3-③, S49-51): 사람이 누른 것만(웹이 confirm:true를 붙인 것만 받는다). 덮어쓰기 없음(같은 이름은 '이름 (2)'). ──
    // - pfiles:op:{"op":"mkdir","dir":"Download","name":"새 폴더","confirm":true} / {"op":"rename","path":"Download/a.txt","name":"b.txt",…}
    //   / {"op":"trash","paths":["Download/a.txt"],…}(파일만, 안드로이드 휴지통 — 시스템 확인 창) → pfiles:done:{ok,op,path?,count?,error?}
    // - 클라우드 → 폰 받기: pfiles:save:begin:{"dir","name","size","confirm":true} → pfiles:save:part:<base64>… → pfiles:save:end → pfiles:save:{ok,step,got,path?,error?}
    //   받는 동안은 그 폴더의 숨긴 임시 파일(점으로 시작, 목록에 안 보임)에 쓰고, 다 받고 크기가 맞을 때만 번호 붙인 이름으로 바꾼다. 그만두면 임시 파일을 지운다.

    const val SAVE_MAX = 1024L * 1024 * 1024
    /** 한 조각(base64 글자 수). 웹은 384KB 바이트씩 보낸다(base64 512KB). */
    const val PART_MAX = 700_000
    const val TRASH_MAX = 50
    const val NAME_MAX = 255
    const val TEMP_PREFIX = ".web2-part-"

    sealed class Write {
        data class Mkdir(val dir: String, val name: String) : Write()
        data class Rename(val path: String, val name: String) : Write()
        data class Trash(val paths: kotlin.collections.List<String>) : Write()
        data class Begin(val dir: String, val name: String, val size: Long) : Write()
        data class Part(val base64: String) : Write()
        object End : Write()
        object Cancel : Write()
    }

    private val BAD_NAME = Regex("[/\\\\:*?\"<>|]")
    private val B64 = Regex("^[A-Za-z0-9+/]*={0,2}$")

    /** 새 이름 하나: 경로 칸 규칙 + 윈도·SD 카드가 못 받는 글자 없음 + 앞뒤 빈칸·끝 점 없음. */
    fun nameOk(name: String?): Boolean =
        name != null && segmentOk(name) && name.length <= NAME_MAX && !BAD_NAME.containsMatchIn(name) && name.trim() == name && !name.endsWith(".")

    /** 폴더 값: 빈 글(맨 위) 또는 막히지 않은 상대 경로. */
    fun dirOk(dir: String?): Boolean = dir != null && (dir.isEmpty() || segments(dir) != null)

    fun write(data: String?): Write? {
        if (data == null || data.length > PART_MAX + 40) return null
        return when {
            data.startsWith("pfiles:op:") -> op(data.substring("pfiles:op:".length))
            data.startsWith("pfiles:save:begin:") -> begin(data.substring("pfiles:save:begin:".length))
            data.startsWith("pfiles:save:part:") -> data.substring("pfiles:save:part:".length)
                .takeIf { it.isNotEmpty() && it.length <= PART_MAX && it.length % 4 == 0 && B64.matches(it) }?.let { Write.Part(it) }
            data == "pfiles:save:end" -> Write.End
            data == "pfiles:save:cancel" -> Write.Cancel
            else -> null
        }
    }

    private fun obj(raw: String): Map<String, Any?>? {
        if (raw.length > 40_000) return null
        val o = try { MiniJson.obj(MiniJson.parse(raw)) } catch (_: Exception) { null } ?: return null
        return if (o["confirm"] == true) o else null
    }

    private fun op(raw: String): Write? {
        val o = obj(raw) ?: return null
        return when (MiniJson.str(o["op"])) {
            "mkdir" -> {
                val dir = MiniJson.str(o["dir"]) ?: ""
                val name = MiniJson.str(o["name"])
                if (!dirOk(dir) || !nameOk(name) || segments(if (dir.isEmpty()) name!! else "$dir/$name") == null) null else Write.Mkdir(dir, name!!)
            }
            "rename" -> {
                val path = MiniJson.str(o["path"]) ?: return null
                val name = MiniJson.str(o["name"])
                if (segments(path) == null || !nameOk(name)) return null
                val parent = path.substringBeforeLast('/', "")
                if (segments(if (parent.isEmpty()) name!! else "$parent/$name") == null) null else Write.Rename(path, name!!)
            }
            "trash" -> {
                val list = MiniJson.list(o["paths"]) ?: return null
                if (list.isEmpty() || list.size > TRASH_MAX) return null
                val paths = list.map { (it as? String)?.takeIf { p -> segments(p) != null } ?: return null }.distinct()
                Write.Trash(paths)
            }
            else -> null
        }
    }

    private fun begin(raw: String): Write.Begin? {
        val o = obj(raw) ?: return null
        val dir = MiniJson.str(o["dir"]) ?: ""
        val name = MiniJson.str(o["name"])
        val size = MiniJson.num(o["size"])?.takeIf { it == Math.floor(it) && it >= 0 && it <= SAVE_MAX }?.toLong() ?: return null
        if (!dirOk(dir) || !nameOk(name)) return null
        if (segments(if (dir.isEmpty()) name!! else "$dir/$name") == null) return null
        return Write.Begin(dir, name!!, size)
    }

    /** 받은 크기 세기: 선언한 크기를 넘으면 거절, 같아야 끝. */
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

    private val EXT = Regex("\\.([A-Za-z0-9]{1,10})$")
    private val NUMBERED = Regex("^(.*\\S) \\((\\d{1,4})\\)$")

    /**
     * 같은 이름이면 '이름 (2).확장자'처럼 번호(웹 app/file-rename-name.mjs numberedName과 같은 규칙, 대소문자 무시).
     * taken = 그 폴더에 이미 있는 이름들.
     */
    fun numbered(name: String, taken: Collection<String>): String {
        val lower = taken.map { it.lowercase() }.toSet()
        if (name.lowercase() !in lower) return name
        val m = EXT.find(name)
        val (full, ext) = if (m == null || m.range.first == 0) name to "" else name.substring(0, m.range.first) to name.substring(m.range.first)
        val n = NUMBERED.matchEntire(full)
        val base = n?.groupValues?.get(1) ?: full
        var i = n?.groupValues?.get(2)?.toInt()?.plus(1) ?: 2
        while (i < 10000) {
            val c = "$base ($i)$ext"
            if (c.lowercase() !in lower) return c
            i++
        }
        return "$base (${System.currentTimeMillis()})$ext"
    }

    fun doneMessage(ok: Boolean, op: String, path: String? = null, count: Int = 0, error: String = ""): String {
        val sb = StringBuilder("pfiles:done:{\"ok\":").append(ok).append(",\"op\":").append(ShellRules.jsonString(op))
        if (path != null) sb.append(",\"path\":").append(ShellRules.jsonString(path))
        sb.append(",\"count\":").append(count)
        if (error.isNotEmpty()) sb.append(",\"error\":").append(ShellRules.jsonString(error))
        return sb.append('}').toString()
    }

    fun saveMessage(ok: Boolean, step: String, got: Long = 0, path: String? = null, error: String = ""): String {
        val sb = StringBuilder("pfiles:save:{\"ok\":").append(ok).append(",\"step\":").append(ShellRules.jsonString(step)).append(",\"got\":").append(got)
        if (path != null) sb.append(",\"path\":").append(ShellRules.jsonString(path))
        if (error.isNotEmpty()) sb.append(",\"error\":").append(ShellRules.jsonString(error))
        return sb.append('}').toString()
    }

    private fun sameKey(a: String, b: String): Boolean = MessageDigest.isEqual(a.toByteArray(), b.toByteArray())

    private fun query(raw: String?): Map<String, String>? {
        if (raw.isNullOrEmpty()) return emptyMap()
        val out = LinkedHashMap<String, String>()
        for (part in raw.split('&')) {
            if (part.isEmpty()) continue
            val i = part.indexOf('=')
            val k = if (i < 0) part else part.substring(0, i)
            val v = if (i < 0) "" else part.substring(i + 1)
            val key = try { URLDecoder.decode(k, "UTF-8") } catch (_: Exception) { return null }
            val value = try { URLDecoder.decode(v, "UTF-8") } catch (_: Exception) { return null }
            if (key !in setOf("dir", "path", "limit", "s") || out.containsKey(key)) return null
            out[key] = value
        }
        return out
    }
}
