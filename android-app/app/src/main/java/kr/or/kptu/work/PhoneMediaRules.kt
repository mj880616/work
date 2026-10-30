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
        data class Page(val sort: String, val filter: String, val offset: Int, val limit: Int, val beforeMs: Long?) : Request()
        data class Ids(val ids: List<Long>) : Request()
        data class Months(val filter: String) : Request()
        data class Days(val month: String, val filter: String, val prefer: Set<Long>) : Request()
        data class Thumb(val id: Long, val large: Boolean) : Request()
        data class Original(val id: Long) : Request()
        /** __phone 주소이지만 열쇠·모양이 틀림 → 404. */
        object Bad : Request()
    }

    private val PATH = Regex("^(?:/work/app)?/__phone/([A-Za-z0-9_-]{22,64})/(page|ids|months|days|thumb/([0-9]{1,18})|media/([0-9]{1,18}))$")
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
        if (!isKey(key) || !sameKey(m.groupValues[1], key)) return Request.Bad
        val q = query(u.rawQuery) ?: return Request.Bad
        val what = m.groupValues[2]
        val filter = q["filter"] ?: "all"
        return when {
            what == "page" -> {
                val sort = q["sort"] ?: "taken_desc"
                val offset = q["offset"]?.let(::smallInt) ?: if (q.containsKey("offset")) return Request.Bad else 0
                val limit = q["limit"]?.let(::smallInt) ?: if (q.containsKey("limit")) return Request.Bad else 120
                val before = q["before"]?.let { if (NUMBER.matches(it)) it.toLong() else return Request.Bad }
                if (sort !in SORTS || filter !in FILTERS || filter == "star" || limit !in 1..PAGE_MAX) return Request.Bad
                Request.Page(sort, filter, offset, limit, before)
            }
            what == "ids" -> {
                val ids = numbers(q["ids"] ?: "") ?: return Request.Bad
                if (ids.isEmpty() || ids.size > IDS_MAX) return Request.Bad
                Request.Ids(ids)
            }
            what == "months" -> if (filter !in FILTERS || filter == "star") Request.Bad else Request.Months(filter)
            what == "days" -> {
                val month = q["month"] ?: return Request.Bad
                val prefer = (q["prefer"]?.let { numbers(it) ?: return Request.Bad } ?: emptyList()).toSet()
                if (!MONTH.matches(month) || filter !in FILTERS || filter == "star" || prefer.size > IDS_MAX) return Request.Bad
                Request.Days(month, filter, prefer)
            }
            what.startsWith("thumb/") -> {
                val size = q["s"] ?: "small"
                if (size != "small" && size != "large") return Request.Bad
                Request.Thumb(m.groupValues[3].toLong(), size == "large")
            }
            else -> if (q.isNotEmpty()) Request.Bad else Request.Original(m.groupValues[4].toLong())
        }
    }

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
            if (key !in setOf("sort", "filter", "offset", "limit", "before", "ids", "month", "prefer", "s") || out.containsKey(key)) return null
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
    fun stateMessage(access: Access, key: String, sdk: Int): String {
        val name = access.name.lowercase()
        val sb = StringBuilder("photos:state:{\"access\":\"").append(name).append('"')
        if (access != Access.NONE) sb.append(",\"key\":").append(ShellRules.jsonString(key))
        sb.append(",\"trash\":").append(sdk >= 30).append('}')
        return sb.toString()
    }

    sealed class Message {
        object Hello : Message()
        object Ask : Message()
        data class Trash(val ids: List<Long>) : Message()
    }

    fun message(data: String?): Message? = when {
        data == "photos:hello" -> Message.Hello
        data == "photos:ask" -> Message.Ask
        data != null && data.startsWith("photos:trash:") -> numbers(data.substring("photos:trash:".length))
            ?.takeIf { it.isNotEmpty() && it.size <= TRASH_MAX }?.let { Message.Trash(it) }
        else -> null
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
        val sorted = sorted(filter(list, req.filter), req.sort)
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

    /** 그림 크기: 긴 쪽 기준(작은 그림 320, 크게 보기 1600). */
    fun thumbSide(large: Boolean): Int = if (large) THUMB_LARGE else THUMB_SMALL
}
