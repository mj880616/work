package kr.or.kptu.work

import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * PHOTO-출처 ①(요청함 10/30 17:30): 사진 메뉴의 '폰 사진' 규칙. 안드로이드 API 없이 JVM 단위 시험으로 고정한다.
 * - 웹(app/phone-photos.js)은 다리(KPTUAppShell)로 'photos:hello'를 보내 접근 상태와 이번 실행의 열쇠를 받고,
 *   목록·그림은 https://<허용 호스트>/work/app/__phone/<열쇠>/… 를 fetch한다. 앱이 가로채 폰 안에서 답한다(서버로 나가지 않음).
 * - 열쇠는 앱 프로세스마다 새로 만드는 무작위 값이고 허용 Origin 최상위 화면의 다리에만 준다. 열쇠가 틀리면 404.
 * - 앱은 사진·목록을 저장하지 않는다(메모리에 목록만 잠깐, 그림은 그때그때 만든다).
 */
object PhoneMediaRules {
    data class Media(
        val id: Long,
        val name: String,
        val size: Long,
        /** 찍은 시각(ms). 찍은 시각이 없으면 고친·넣은 시각으로 대신하고 approx=true. */
        val takenMs: Long,
        val approx: Boolean,
        val addedMs: Long,
        val mime: String,
        val width: Int,
        val height: Int,
        val durationMs: Long,
        val video: Boolean,
        val screenshot: Boolean,
        /** PHOTO-출처모든칩: 사진첩 폴더(relative_path, 예 'DCIM/Camera/'). 폰 폴더 보기에만 쓰고 밖으로 보내지 않는다. */
        val folder: String = "",
    )

    enum class Access { FULL, PARTIAL, NONE }

    val SORTS = listOf("taken_desc", "taken_asc", "uploaded_desc", "name_asc", "size_desc", "duration_desc")
    val FILTERS = listOf("all", "star", "video", "shot")
    const val PAGE_MAX = 200
    const val IDS_MAX = 500
    const val TRASH_MAX = 200
    const val THUMB_SMALL = 320
    const val THUMB_LARGE = 1600
    val SEOUL: ZoneId = ZoneId.of("Asia/Seoul")

    sealed class Request {
        data class Page(val sort: String, val filter: String, val offset: Int, val limit: Int, val beforeMs: Long?, val folder: String? = null, val hide: Set<String> = emptySet()) : Request()
        /** PHOTO-출처모든칩: 폰 폴더 목록(폴더마다 장수·대표 1장). */
        object Folders : Request()
        data class Ids(val ids: List<Long>, val hide: Set<String> = emptySet()) : Request()
        data class Months(val filter: String, val hide: Set<String> = emptySet()) : Request()
        data class Days(val month: String, val filter: String, val prefer: Set<Long>, val hide: Set<String> = emptySet()) : Request()
        data class Thumb(val id: Long, val large: Boolean) : Request()
        data class Original(val id: Long) : Request()
        /** __phone 주소이지만 모양(호스트·방법·값)이 틀림 → 400 bad_request. */
        object Bad : Request()
        /** __phone 주소·모양은 맞지만 열쇠가 틀리거나 아직 없음(앱을 다시 켠 뒤 옛 화면 등) → 403 key. */
        object WrongKey : Request()
    }

    // ── 실패 종류(PHOTO-폰사진못읽음, 요청함 10/30 23:58) ──
    // 예전에는 모든 실패를 빈 404로 돌려줘 웹이 이유를 몰랐다. 이제 상태 코드 + {"error":종류,"detail":예외 클래스 이름}.
    // 사진 이름·경로·내용·예외 글(message)은 넣지 않는다(예외 글에 경로가 들어갈 수 있다).

    enum class Fail(val code: String, val status: Int) {
        PERMISSION("permission", 403),
        KEY("key", 403),
        BAD_REQUEST("bad_request", 400),
        QUERY("query", 500),
        COLUMN("column", 500),
        DECODE("decode", 500),
        NOT_FOUND("not_found", 404),
    }

    /** 어느 단계에서 났나: 목록(사진첩 조회) / 작은 그림 / 원본. */
    enum class Stage { LIST, THUMB, ORIGINAL }

    fun stageOf(req: Request): Stage = when (req) {
        is Request.Thumb -> Stage.THUMB
        is Request.Original -> Stage.ORIGINAL
        else -> Stage.LIST
    }

    /** 예외 → 실패 종류. 예외 글은 판정에만 쓰고 밖으로 내보내지 않는다. */
    fun classify(e: Throwable, stage: Stage): Fail {
        val columnLike = (e is IllegalArgumentException || e.javaClass.simpleName.contains("SQLite")) &&
            (e.message ?: "").contains("column", ignoreCase = true)
        return when {
            e is SecurityException -> Fail.PERMISSION
            stage == Stage.LIST && columnLike -> Fail.COLUMN
            stage == Stage.LIST -> Fail.QUERY
            e is java.io.FileNotFoundException -> Fail.NOT_FOUND
            else -> Fail.DECODE
        }
    }

    /** 응답에 넣을 짧은 이름(예외 클래스 이름만, 글자·숫자·_·$·.만, 60자까지). */
    fun detailOf(e: Throwable?): String = safeDetail(e?.javaClass?.simpleName)

    fun safeDetail(v: String?): String = (v ?: "").filter { it.isLetterOrDigit() && it.code < 128 || it == '_' || it == '$' || it == '.' }.take(60)

    fun failJson(fail: Fail, detail: String = ""): String =
        "{\"error\":\"" + fail.code + "\",\"detail\":" + ShellRules.jsonString(safeDetail(detail)) + "}"

    fun reasonPhrase(status: Int): String = when (status) {
        400 -> "Bad Request"
        403 -> "Forbidden"
        404 -> "Not Found"
        else -> "Internal Server Error"
    }

    /**
     * 사진·동영상 모음을 따로 읽어 합친다(안드로이드 13+ 사진·동영상 권한은 모음별). 둘 다 못 읽었으면 null(→ 첫 실패를 돌려준다).
     * 한쪽만 읽었으면 그쪽만 쓴다. 같은 번호가 겹치면 한 번만.
     */
    fun combine(images: List<Media>?, videos: List<Media>?): List<Media>? {
        if (images == null && videos == null) return null
        val seen = HashSet<Long>()
        return (images.orEmpty() + videos.orEmpty()).filter { seen.add(it.id) }
    }

    private val PATH = Regex("^(?:/work/app)?/__phone/([A-Za-z0-9_-]{22,64})/(page|ids|months|days|folders|thumb/([0-9]{1,18})|media/([0-9]{1,18}))$")
    private val MONTH = Regex("^[0-9]{4}-(0[1-9]|1[0-2])$")
    private val NUMBER = Regex("^[0-9]{1,18}$")
    private val KEY = Regex("^[A-Za-z0-9_-]{22,64}$")

    fun isKey(value: String?): Boolean = value != null && KEY.matches(value)

    /**
     * 가로챌 주소인가. __phone 주소가 아니면 null(평소대로 서버로), 주소는 맞지만 열쇠·값이 틀리면 Bad.
     * https·허용 호스트·기본 포트·사용자 정보 없음·GET만.
     */
    fun request(url: String?, method: String?, key: String): Request? {
        val u = try {
            if (url == null) null else URI(url)
        } catch (_: Exception) {
            null
        } ?: return null
        val path = u.rawPath ?: return null
        if (!path.contains("/__phone/")) return null
        if (!"https".equals(u.scheme, ignoreCase = true) || u.rawUserInfo != null) return Request.Bad
        if (u.port != -1 && u.port != 443) return Request.Bad
        if ((u.host?.lowercase() ?: "") !in ShellRules.INTERNAL_HOSTS) return Request.Bad
        if (!"GET".equals(method, ignoreCase = true) || u.rawFragment != null) return Request.Bad
        val m = PATH.matchEntire(path) ?: return Request.Bad
        if (!isKey(key) || !sameKey(m.groupValues[1], key)) return Request.WrongKey
        val q = query(u.rawQuery) ?: return Request.Bad
        val what = m.groupValues[2]
        val filter = q["filter"] ?: "all"
        // PHOTO-폴더스위치(0.4.1): hide = 끈 폰 폴더(JSON 글자 배열). 사진 목록·달·날·번호 읽기에서 그 폴더 바로 안 사진을 뺀다.
        val hide = if (q.containsKey("hide")) hideList(q["hide"]) ?: return Request.Bad else emptySet()
        if (hide.isNotEmpty() && what != "page" && what != "ids" && what != "months" && what != "days") return Request.Bad
        return when {
            what == "page" -> {
                val sort = q["sort"] ?: "taken_desc"
                val offset = q["offset"]?.let(::smallInt) ?: if (q.containsKey("offset")) return Request.Bad else 0
                val limit = q["limit"]?.let(::smallInt) ?: if (q.containsKey("limit")) return Request.Bad else 120
                val before = q["before"]?.let { if (NUMBER.matches(it)) it.toLong() else return Request.Bad }
                val folder = q["folder"]?.let { if (isFolder(it)) it else return Request.Bad }
                if (sort !in SORTS || filter !in FILTERS || filter == "star" || limit !in 1..PAGE_MAX) return Request.Bad
                Request.Page(sort, filter, offset, limit, before, folder, hide)
            }
            what == "ids" -> {
                val ids = numbers(q["ids"] ?: "") ?: return Request.Bad
                if (ids.isEmpty() || ids.size > IDS_MAX) return Request.Bad
                Request.Ids(ids, hide)
            }
            what == "folders" -> if (q.isNotEmpty()) Request.Bad else Request.Folders
            what == "months" -> if (filter !in FILTERS || filter == "star") Request.Bad else Request.Months(filter, hide)
            what == "days" -> {
                val month = q["month"] ?: return Request.Bad
                val prefer = (q["prefer"]?.let { numbers(it) ?: return Request.Bad } ?: emptyList()).toSet()
                if (!MONTH.matches(month) || filter !in FILTERS || filter == "star" || prefer.size > IDS_MAX) return Request.Bad
                Request.Days(month, filter, prefer, hide)
            }
            what.startsWith("thumb/") -> {
                val size = q["s"] ?: "small"
                if (size != "small" && size != "large") return Request.Bad
                Request.Thumb(m.groupValues[3].toLong(), size == "large")
            }
            else -> if (q.isNotEmpty()) Request.Bad else Request.Original(m.groupValues[4].toLong())
        }
    }

    /** 폰 폴더 값: 빈 값(사진첩 맨 위) 또는 255자 이하, 줄바꿈·제어 글자 없음. */
    fun isFolder(v: String): Boolean = v.length <= 255 && v.none { it.isISOControl() }

    const val HIDE_MAX = 80

    /** 끈 폰 폴더 목록: JSON 글자 배열, 80개까지, 칸마다 isFolder. 모양이 다르면 null(→ 400). */
    fun hideList(raw: String?): Set<String>? {
        if (raw == null || raw.length > 40_000) return null
        val list = try { MiniJson.list(MiniJson.parse(raw)) } catch (_: Exception) { null } ?: return null
        if (list.size > HIDE_MAX) return null
        val out = LinkedHashSet<String>()
        for (v in list) {
            val s = v as? String ?: return null
            if (!isFolder(s)) return null
            out.add(s)
        }
        return out
    }

    /** 끈 폴더 바로 안 사진을 뺀다(하위 폴더는 따로 켜고 끈다). */
    fun visible(list: List<Media>, hide: Set<String>): List<Media> = if (hide.isEmpty()) list else list.filter { it.folder !in hide }

    private fun sameKey(a: String, b: String): Boolean = MessageDigest.isEqual(a.toByteArray(), b.toByteArray())

    private fun smallInt(v: String): Int? = if (Regex("^[0-9]{1,6}$").matches(v)) v.toInt() else null

    private fun numbers(v: String): List<Long>? {
        if (v.isEmpty()) return emptyList()
        val parts = v.split(',')
        if (parts.size > IDS_MAX) return null
        val out = ArrayList<Long>(parts.size)
        for (p in parts) {
            if (!NUMBER.matches(p)) return null
            out.add(p.toLong())
        }
        return out.distinct()
    }

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
            if (key !in setOf("sort", "filter", "offset", "limit", "before", "ids", "month", "prefer", "s", "folder", "hide") || out.containsKey(key)) return null
            out[key] = value
        }
        return out
    }

    // ── 권한(안드로이드 13+ 사진·동영상, 14+ 부분 허용) ──

    const val READ_IMAGES = "android.permission.READ_MEDIA_IMAGES"
    const val READ_VIDEO = "android.permission.READ_MEDIA_VIDEO"
    const val READ_SELECTED = "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
    const val READ_STORAGE = "android.permission.READ_EXTERNAL_STORAGE"

    /** 처음 한 번 '사진 접근 허용'에서 물을 권한. 14+는 부분 허용(고른 사진만)도 함께 넣어야 시스템이 그 선택지를 보인다. */
    fun permissionsToAsk(sdk: Int): List<String> = when {
        sdk >= 34 -> listOf(READ_IMAGES, READ_VIDEO, READ_SELECTED)
        sdk >= 33 -> listOf(READ_IMAGES, READ_VIDEO)
        else -> listOf(READ_STORAGE)
    }

    /** 지금 허락 상태. granted = 허락된 권한 이름. 사진·동영상 중 하나라도 전체 허락이면 FULL, 14+에서 고른 사진만이면 PARTIAL. */
    fun access(sdk: Int, granted: Set<String>): Access = when {
        sdk >= 33 && (READ_IMAGES in granted || READ_VIDEO in granted) -> Access.FULL
        sdk >= 34 && READ_SELECTED in granted -> Access.PARTIAL
        sdk < 33 && READ_STORAGE in granted -> Access.FULL
        else -> Access.NONE
    }

    /** 다리로 보내는 상태 글. 접근이 없으면 열쇠를 주지 않는다. trash = 폰 휴지통 보내기를 할 수 있는 폰(안드로이드 11+). */
    fun stateMessage(access: Access, key: String, sdk: Int, manage: Boolean = false): String {
        val name = access.name.lowercase()
        val sb = StringBuilder("photos:state:{\"access\":\"").append(name).append('"')
        if (access != Access.NONE) sb.append(",\"key\":").append(ShellRules.jsonString(key))
        sb.append(",\"trash\":").append(sdk >= 30)
        // PHOTO-폴더스위치(0.4.1): hide = 끈 폴더 거르기를 안다, ops = 폰 폴더 바꾸기(안드로이드 11+), manage = '미디어 관리 허용'이 켜짐(12+).
        sb.append(",\"hide\":true,\"ops\":").append(sdk >= 30).append(",\"manage\":").append(manage)
        return sb.append('}').toString()
    }

    sealed class Message {
        object Hello : Message()
        object Ask : Message()
        /** PHOTO-폴더스위치: '미디어 관리 허용' 설정 화면 열기(안드로이드 12+). 켜 두면 폴더 바꾸기·지우기 때 매번 묻지 않는다. */
        object Manage : Message()
        data class Trash(val ids: List<Long>) : Message()
        /** PHOTO-폴더스위치: 폰 폴더 바꾸기(op 하나). */
        data class Op(val op: FolderOp) : Message()
    }

    fun message(data: String?): Message? = when {
        data == "photos:hello" -> Message.Hello
        data == "photos:ask" -> Message.Ask
        data == "photos:manage" -> Message.Manage
        data != null && data.startsWith("photos:trash:") -> numbers(data.substring("photos:trash:".length))
            ?.takeIf { it.isNotEmpty() && it.size <= TRASH_MAX }?.let { Message.Trash(it) }
        data != null && data.startsWith("photos:op:") -> folderOp(data.substring("photos:op:".length))?.let { Message.Op(it) }
        else -> null
    }

    // ── 폰 폴더 바꾸기(PHOTO-폴더스위치 ③, 0.4.1) ──
    // 안드로이드 사진첩 폴더는 사진들의 relative_path다(빈 폴더는 없다). 그래서
    // - 이름 바꾸기·폴더 옮기기 = 그 폴더(와 하위 폴더) 사진의 relative_path 앞부분을 바꾼다.
    // - 고른 사진 옮기기 = 그 사진들의 relative_path를 옮길 폴더로(새 폴더면 사진이 들어가며 생긴다).
    // - 폴더 지우기 = 그 폴더(와 하위 폴더) 사진을 폰 휴지통으로(시스템 확인 창, '미디어 관리 허용'이면 바로).
    // 옮길 곳은 DCIM/·Pictures/ 아래만(안드로이드가 사진·동영상을 받는 곳). 사진 이름·경로는 로그에 쓰지 않는다.

    const val OP_MAX = 2000
    const val NAME_MAX = 60
    val TOPS = listOf("DCIM/", "Pictures/")

    sealed class FolderOp {
        data class Move(val ids: List<Long>, val to: String) : FolderOp()
        data class Rename(val from: String, val name: String) : FolderOp()
        data class MoveFolder(val from: String, val into: String) : FolderOp()
        data class TrashFolder(val from: String) : FolderOp()
    }

    /** 새 폴더 이름: 1~60자, '/'·제어 글자·앞 '.' 없음, 앞뒤 빈칸 없음. */
    fun isName(v: String?): Boolean = v != null && v.length in 1..NAME_MAX && v == v.trim() && !v.startsWith(".") &&
        v.none { it == '/' || it == '\\' || it.isISOControl() }

    /** 폴더 경로 모양: 'DCIM/…/' 또는 'Pictures/…/'(끝 '/' 하나, 빈 칸 없음, 칸마다 isName). */
    fun isTarget(v: String?): Boolean {
        if (v == null || v.length > 255 || !v.endsWith("/") || TOPS.none { v.startsWith(it) }) return false
        return v.dropLast(1).split('/').drop(1).all { isName(it) }
    }

    /** 바꿀 수 있는 폴더(사진첩 맨 위 '·DCIM·Pictures 자체는 안 됨). */
    fun isMovable(v: String?): Boolean = isTarget(v) && TOPS.none { it == v }

    fun parentOf(path: String): String = path.dropLast(1).substringBeforeLast('/', "").let { if (it.isEmpty()) "" else "$it/" }

    fun folderOp(raw: String): FolderOp? {
        if (raw.length > 60_000) return null
        val o = try { MiniJson.obj(MiniJson.parse(raw)) } catch (_: Exception) { null } ?: return null
        return when (MiniJson.str(o["op"])) {
            "move" -> {
                val list = MiniJson.list(o["ids"]) ?: return null
                val ids = ArrayList<Long>(list.size)
                for (v in list) {
                    val t = MiniJson.str(v) ?: return null
                    if (!NUMBER.matches(t)) return null
                    ids.add(t.toLong())
                }
                val to = MiniJson.str(o["to"]) ?: return null
                val uniq = ids.distinct()
                if (uniq.isEmpty() || uniq.size > OP_MAX || !isTarget(to)) null else FolderOp.Move(uniq, to)
            }
            "rename" -> {
                val from = MiniJson.str(o["from"]) ?: return null
                val name = MiniJson.str(o["name"]) ?: return null
                if (!isMovable(from) || !isName(name) || !isTarget(parentOf(from) + name + "/")) null else FolderOp.Rename(from, name)
            }
            "movefolder" -> {
                val from = MiniJson.str(o["from"]) ?: return null
                val into = MiniJson.str(o["into"]) ?: return null
                val leaf = from.dropLast(1).substringAfterLast('/')
                if (!isMovable(from) || !isTarget(into) || into.startsWith(from) || parentOf(from) == into || !isTarget("$into$leaf/")) null
                else FolderOp.MoveFolder(from, into)
            }
            "trashfolder" -> {
                val from = MiniJson.str(o["from"]) ?: return null
                if (from.isEmpty() || !isFolder(from) || TOPS.any { it == from } || !from.endsWith("/")) null else FolderOp.TrashFolder(from)
            }
            else -> null
        }
    }

    /** 그 폴더 또는 그 아래 폴더인가. */
    fun under(path: String, folder: String): Boolean = path == folder || path.startsWith(folder)

    /** 바꾼 뒤 경로(바꾸지 않는 사진은 null). */
    fun newPath(m: Media, op: FolderOp): String? = when (op) {
        is FolderOp.Move -> if (m.id in op.ids && m.folder != op.to) op.to else null
        is FolderOp.Rename -> if (under(m.folder, op.from)) parentOf(op.from) + op.name + "/" + m.folder.substring(op.from.length) else null
        is FolderOp.MoveFolder -> if (under(m.folder, op.from)) op.into + op.from.dropLast(1).substringAfterLast('/') + "/" + m.folder.substring(op.from.length) else null
        is FolderOp.TrashFolder -> null
    }

    /** 이번 바꾸기에 드는 사진(지우기는 그 폴더와 하위 폴더 모두). */
    fun targets(list: List<Media>, op: FolderOp): List<Media> = when (op) {
        is FolderOp.TrashFolder -> list.filter { under(it.folder, op.from) }
        else -> list.filter { newPath(it, op) != null }
    }

    /** 바꾼 폴더 경로(화면이 끈 폴더 목록을 맞춤): 이름 바꾸기·폴더 옮기기 = 새 경로, 그 밖 = null. */
    fun opPath(op: FolderOp): String? = when (op) {
        is FolderOp.Rename -> parentOf(op.from) + op.name + "/"
        is FolderOp.MoveFolder -> op.into + op.from.dropLast(1).substringAfterLast('/') + "/"
        else -> null
    }

    /** 다리 답: ok·count(바꾼 장수)·error(종류: none·denied·refused·failed·old)·path(새 폴더 경로). */
    fun doneMessage(ok: Boolean, count: Int, error: String = "", path: String? = null): String {
        val sb = StringBuilder("photos:done:{\"ok\":").append(ok).append(",\"count\":").append(count)
        sb.append(",\"error\":").append(ShellRules.jsonString(error.filter { it in 'a'..'z' }.take(20)))
        if (path != null) sb.append(",\"path\":").append(ShellRules.jsonString(path.take(255)))
        return sb.append('}').toString()
    }

    fun trashedMessage(ok: Boolean, count: Int): String = "photos:trashed:{\"ok\":$ok,\"count\":$count}"

    // ── 목록 ──

    /** 스크린샷: 폴더 이름(Screenshots·스크린샷) 또는 파일 이름이 Screenshot으로 시작. */
    fun isScreenshot(relativePath: String?, name: String?): Boolean {
        val p = (relativePath ?: "").lowercase()
        val n = (name ?: "").lowercase()
        return p.contains("screenshot") || p.contains("스크린샷") || n.startsWith("screenshot")
    }

    /** 찍은 시각 고르기: date_taken(ms) > 0이면 그것, 아니면 고친 시각(초)·넣은 시각(초) → approx. */
    fun taken(dateTakenMs: Long?, modifiedSec: Long?, addedSec: Long?): Pair<Long, Boolean> = when {
        dateTakenMs != null && dateTakenMs > 0 -> dateTakenMs to false
        modifiedSec != null && modifiedSec > 0 -> modifiedSec * 1000 to true
        addedSec != null && addedSec > 0 -> addedSec * 1000 to true
        else -> 0L to true
    }

    fun filter(list: List<Media>, filter: String): List<Media> = when (filter) {
        "video" -> list.filter { it.video }
        "shot" -> list.filter { it.screenshot }
        else -> list
    }

    private val nameOrder = compareBy<Media, String>(String.CASE_INSENSITIVE_ORDER) { it.name }

    fun comparator(sort: String): Comparator<Media> = when (sort) {
        "taken_asc" -> compareBy<Media> { it.takenMs }.thenBy { it.id }
        "uploaded_desc" -> compareByDescending<Media> { it.addedMs }.thenByDescending { it.id }
        "name_asc" -> nameOrder.thenBy { it.id }
        "size_desc" -> compareByDescending<Media> { it.size }.thenByDescending { it.id }
        "duration_desc" -> compareByDescending<Media> { it.durationMs }.thenByDescending { it.id }
        else -> compareByDescending<Media> { it.takenMs }.thenByDescending { it.id }
    }

    fun sorted(list: List<Media>, sort: String): List<Media> = list.sortedWith(comparator(sort))

    /** 달·날로 건너뛰기(찍은 날 최근 먼저 목록에서): 찍은 시각이 before보다 앞인 첫 자리. */
    fun startIndex(sortedDesc: List<Media>, beforeMs: Long): Int {
        val i = sortedDesc.indexOfFirst { it.takenMs < beforeMs }
        return if (i < 0) sortedDesc.size else i
    }

    data class Page(val items: List<Media>, val next: Int?, val total: Int)

    /** 한 쪽. 날로 건너뛰면(before, 찍은 날 최근 먼저만) 그 자리가 0이고 offset·next는 그 자리부터 센다. */
    fun page(list: List<Media>, req: Request.Page): Page {
        val inFolder = if (req.folder == null) list else list.filter { it.folder == req.folder }
        val sorted = sorted(filter(inFolder, req.filter), req.sort)
        val start = if (req.beforeMs != null && req.sort == "taken_desc") startIndex(sorted, req.beforeMs) else 0
        val from = (start + req.offset).coerceIn(0, sorted.size)
        val to = (from + req.limit).coerceAtMost(sorted.size)
        val next = if (to < sorted.size) req.offset + (to - from) else null
        return Page(sorted.subList(from, to), next, sorted.size)
    }

    private val ISO: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)
    private val DAY: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(SEOUL)

    fun iso(ms: Long): String = ISO.format(Instant.ofEpochMilli(ms))
    fun day(ms: Long): String = DAY.format(Instant.ofEpochMilli(ms))

    fun itemJson(m: Media): String {
        val sb = StringBuilder("{\"id\":\"").append(m.id).append('"')
        sb.append(",\"name\":").append(ShellRules.jsonString(m.name.take(255)))
        sb.append(",\"taken_at\":\"").append(iso(m.takenMs)).append('"')
        sb.append(",\"approx\":").append(m.approx)
        sb.append(",\"day\":\"").append(day(m.takenMs)).append('"')
        sb.append(",\"kind\":\"").append(if (m.video) "video" else "photo").append('"')
        sb.append(",\"width\":").append(if (m.width > 0) m.width.toString() else "null")
        sb.append(",\"height\":").append(if (m.height > 0) m.height.toString() else "null")
        sb.append(",\"duration_ms\":").append(if (m.video && m.durationMs > 0) m.durationMs.toString() else "null")
        sb.append(",\"screenshot\":").append(m.screenshot)
        sb.append(",\"size_bytes\":").append(if (m.size >= 0) m.size.toString() else "null")
        sb.append(",\"uploaded_at\":\"").append(iso(m.addedMs)).append('"')
        // PHOTO-폴더스위치(0.4.1): 사진마다 폰 폴더(relative_path). 화면 메모리에서만 쓴다(서버로 보내지 않음).
        sb.append(",\"folder\":").append(ShellRules.jsonString(m.folder.take(255)))
        return sb.append('}').toString()
    }

    fun pageJson(p: Page): String =
        "{\"items\":[" + p.items.joinToString(",", transform = ::itemJson) + "],\"next\":" + (p.next?.toString() ?: "null") + ",\"total\":" + p.total + "}"

    fun idsJson(list: List<Media>, ids: List<Long>): String {
        val byId = list.associateBy { it.id }
        return "{\"items\":[" + ids.mapNotNull { byId[it] }.joinToString(",", transform = ::itemJson) + "]}"
    }

    /** 달마다 장수(빠른 이동 막대). */
    fun months(list: List<Media>): Map<String, Int> {
        val out = sortedMapOf<String, Int>(reverseOrder())
        for (m in list) out.merge(day(m.takenMs).substring(0, 7), 1) { a, b -> a + b }
        return out
    }

    fun monthsJson(list: List<Media>): String =
        "{\"months\":{" + months(list).entries.joinToString(",") { "\"${it.key}\":${it.value}" } + "}}"

    /** 그 달 날마다 장수·대표 1장(별표한 것 먼저, 없으면 그날 가장 최근 사진, 사진이 없으면 동영상). */
    fun daysJson(list: List<Media>, month: String, prefer: Set<Long>): String {
        val byDay = sortedMapOf<String, MutableList<Media>>()
        for (m in sorted(list, "taken_desc")) {
            val d = day(m.takenMs)
            if (d.startsWith("$month-")) byDay.getOrPut(d) { mutableListOf() }.add(m)
        }
        return "{\"days\":{" + byDay.entries.joinToString(",") { (d, ms) ->
            val cover = ms.firstOrNull { it.id in prefer } ?: ms.firstOrNull { !it.video } ?: ms.first()
            "\"$d\":{\"count\":${ms.size},\"cover\":${itemJson(cover)}}"
        } + "}}"
    }

    // ── 폰 폴더(PHOTO-출처모든칩) ──

    /** 폴더 이름 = relative_path의 마지막 칸('DCIM/Camera/' → 'Camera'). 비면 '폰'. */
    fun folderName(path: String): String = path.trimEnd('/').substringAfterLast('/').ifEmpty { "폰" }

    data class Folder(val path: String, val name: String, val count: Int, val cover: Media, val latestMs: Long)

    /** 폴더마다 장수·대표(가장 최근 사진, 사진이 없으면 동영상). 최근 사진이 있는 폴더 먼저, 같으면 이름순. */
    fun folders(list: List<Media>): List<Folder> {
        val by = LinkedHashMap<String, MutableList<Media>>()
        for (m in sorted(list, "taken_desc")) by.getOrPut(m.folder) { mutableListOf() }.add(m)
        return by.map { (path, ms) -> Folder(path, folderName(path), ms.size, ms.firstOrNull { !it.video } ?: ms.first(), ms.first().takenMs) }
            .sortedWith(compareByDescending<Folder> { it.latestMs }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name }.thenBy { it.path })
    }

    fun foldersJson(list: List<Media>): String = "{\"folders\":[" + folders(list).joinToString(",") {
        "{\"id\":" + ShellRules.jsonString(it.path.take(255)) + ",\"name\":" + ShellRules.jsonString(it.name.take(255)) + ",\"count\":" + it.count + ",\"cover\":" + itemJson(it.cover) + "}"
    } + "]}"

    /** 그림 크기: 긴 쪽 기준(작은 그림 320, 크게 보기 1600). */
    fun thumbSide(large: Boolean): Int = if (large) THUMB_LARGE else THUMB_SMALL
}
