package kr.or.kptu.work

import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * S48-60 PHOTO-정보고치기(요청함 11/03 00:29, 명진 결정 E1·E2): 웹2에서 폰 사진의 찍은 날·시각과 위치를 고친다(카메라·렌즈는 보기만).
 * 안드로이드 API 없이 JVM 단위 시험으로 고정하는 규칙만 둔다(파일 읽기·쓰기는 PhotoMeta, 허락 창은 MainActivity).
 *
 * 다리(KPTUAppShell, 허용 Origin 최상위 화면만):
 * - photos:meta:read:["123","456"]  → photos:meta:{"ok","items":[{"id","taken","lat","lon","make","model","lens","can"}],"error"}
 * - photos:meta:write:{"items":[{"id":"123","taken":ms},{"id":"456","loc":{"lat":37.5,"lon":127.0}},{"id":"789","loc":null}]}
 *   = 수정 허락 창 한 번(createWriteRequest) → 장마다 파일 EXIF(시각·위치 칸만) + 사진첩 목록 DATE_TAKEN
 *   → photos:metadone:{"ok","count","failed":["번호"],"error":"refused|none|failed|old|busy|bad"}
 *   taken이 없으면 시각은 그대로, loc가 없으면 위치는 그대로, loc:null이면 위치 지우기.
 * 사진 이름·시각·위치는 로그에 쓰지 않는다. 서버로 보내지 않는다.
 */
object PhotoMetaRules {
    const val MAX = 200
    /** 고칠 수 있는 종류(androidx ExifInterface가 다시 쓸 수 있는 것). HEIC·동영상은 읽기만. */
    val WRITABLE = setOf("image/jpeg", "image/png", "image/webp")
    /** 받는 시각 범위: 1970-01-02 ~ 2100-01-01(잘못 밀어 엉뚱한 해가 되지 않게). */
    const val TAKEN_MIN = 86_400_000L
    const val TAKEN_MAX = 4_102_444_800_000L
    private val NUMBER = Regex("^[0-9]{1,18}$")

    data class Loc(val lat: Double, val lon: Double)

    /** 한 장 고치기. loc = null이면 위치 그대로, clearLoc = 위치 지우기. */
    data class Change(val id: Long, val taken: Long?, val loc: Loc?, val clearLoc: Boolean) {
        val touchesLoc: Boolean get() = loc != null || clearLoc
    }

    sealed class Message {
        data class Read(val ids: List<Long>) : Message()
        data class Write(val changes: List<Change>) : Message()
        object Bad : Message()
    }

    /** 사진 한 장 정보(읽기 답). taken = 사진첩 DATE_TAKEN(ms, 웹2·갤러리 순서와 같은 값). */
    data class Info(
        val id: Long, val taken: Long, val lat: Double?, val lon: Double?,
        val make: String, val model: String, val lens: String, val can: Boolean,
    )

    fun canWrite(mime: String?, video: Boolean): Boolean = !video && (mime ?: "").lowercase(Locale.ROOT) in WRITABLE

    fun validLoc(lat: Double?, lon: Double?): Boolean =
        lat != null && lon != null && lat.isFinite() && lon.isFinite() && lat in -90.0..90.0 && lon in -180.0..180.0 && !(lat == 0.0 && lon == 0.0)

    fun validTaken(ms: Long?): Boolean = ms != null && ms in TAKEN_MIN..TAKEN_MAX

    fun message(data: String?): Message? {
        if (data == null || !data.startsWith("photos:meta:")) return null
        return when {
            data.startsWith("photos:meta:read:") -> readIds(data.substring("photos:meta:read:".length))?.let { Message.Read(it) } ?: Message.Bad
            data.startsWith("photos:meta:write:") -> changes(data.substring("photos:meta:write:".length))?.let { Message.Write(it) } ?: Message.Bad
            else -> Message.Bad
        }
    }

    private fun idOf(v: Any?): Long? {
        val s = when (v) {
            is String -> v
            is Double -> if (v >= 0 && v == Math.floor(v) && v < 1e15) v.toLong().toString() else return null
            else -> return null
        }
        return if (NUMBER.matches(s)) s.toLongOrNull() else null
    }

    private fun readIds(text: String): List<Long>? {
        val list = MiniJson.list(MiniJson.parse(text)) ?: return null
        if (list.isEmpty() || list.size > MAX) return null
        val out = LinkedHashSet<Long>()
        for (v in list) out.add(idOf(v) ?: return null)
        return out.toList()
    }

    private fun changes(text: String): List<Change>? {
        if (text.length > 100_000) return null
        val root = MiniJson.obj(MiniJson.parse(text)) ?: return null
        val items = MiniJson.list(root["items"]) ?: return null
        if (items.isEmpty() || items.size > MAX) return null
        val seen = HashSet<Long>()
        val out = ArrayList<Change>(items.size)
        for (raw in items) {
            val o = MiniJson.obj(raw) ?: return null
            val id = idOf(o["id"]) ?: return null
            if (!seen.add(id)) return null
            val taken = if (o.containsKey("taken")) {
                val n = MiniJson.num(o["taken"]) ?: return null
                if (n != Math.floor(n)) return null
                n.toLong().takeIf { validTaken(it) } ?: return null
            } else null
            var loc: Loc? = null
            var clear = false
            if (o.containsKey("loc")) {
                val l = o["loc"]
                if (l == null) clear = true
                else {
                    val lo = MiniJson.obj(l) ?: return null
                    val lat = MiniJson.num(lo["lat"])
                    val lon = MiniJson.num(lo["lon"])
                    if (!validLoc(lat, lon)) return null
                    loc = Loc(lat!!, lon!!)
                }
            }
            if (taken == null && loc == null && !clear) return null
            out.add(Change(id, taken, loc, clear))
        }
        return out
    }

    /** EXIF 날짜 글자(그 시간대의 벽시계): "yyyy:MM:dd HH:mm:ss". */
    fun exifDate(ms: Long, zone: TimeZone): String {
        val c = Calendar.getInstance(zone, Locale.ROOT)
        c.timeInMillis = ms
        return String.format(
            Locale.ROOT, "%04d:%02d:%02d %02d:%02d:%02d",
            c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH),
            c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE), c.get(Calendar.SECOND),
        )
    }

    /** EXIF 시간대 글자 "+09:00"(그 시각의 시간대 차, 여름 시간 포함). */
    fun exifOffset(ms: Long, zone: TimeZone): String {
        val min = zone.getOffset(ms) / 60_000
        val sign = if (min < 0) '-' else '+'
        val a = Math.abs(min)
        return String.format(Locale.ROOT, "%c%02d:%02d", sign, a / 60, a % 60)
    }

    private fun num(v: Double?): String = if (v == null) "null" else String.format(Locale.ROOT, "%.6f", v)

    private fun text(v: String): String = ShellRules.jsonString(v.filter { it >= ' ' }.take(80))

    fun metaMessage(ok: Boolean, items: List<Info>, error: String = ""): String {
        val sb = StringBuilder("photos:meta:{\"ok\":").append(ok).append(",\"items\":[")
        items.forEachIndexed { i, m ->
            if (i > 0) sb.append(',')
            val hasLoc = validLoc(m.lat, m.lon)
            sb.append("{\"id\":\"").append(m.id).append("\",\"taken\":").append(m.taken)
                .append(",\"lat\":").append(if (hasLoc) num(m.lat) else "null").append(",\"lon\":").append(if (hasLoc) num(m.lon) else "null")
                .append(",\"make\":").append(text(m.make)).append(",\"model\":").append(text(m.model)).append(",\"lens\":").append(text(m.lens))
                .append(",\"can\":").append(m.can).append('}')
        }
        sb.append("],\"error\":").append(ShellRules.jsonString(error.filter { it in 'a'..'z' }.take(20)))
        return sb.append('}').toString()
    }

    fun doneMessage(ok: Boolean, count: Int, failed: List<Long> = emptyList(), error: String = ""): String {
        val sb = StringBuilder("photos:metadone:{\"ok\":").append(ok).append(",\"count\":").append(count).append(",\"failed\":[")
        failed.take(MAX).forEachIndexed { i, id -> if (i > 0) sb.append(','); sb.append('"').append(id).append('"') }
        sb.append("],\"error\":").append(ShellRules.jsonString(error.filter { it in 'a'..'z' }.take(20)))
        return sb.append('}').toString()
    }
}
