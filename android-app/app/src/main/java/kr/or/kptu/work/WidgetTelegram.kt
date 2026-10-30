package kr.or.kptu.work

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * WIDGET-여러개 ③: '웹2 텔레그램' 위젯(4×2)에 그릴 것. 안드로이드 API를 쓰지 않아 JVM 시험 대상이다.
 * 운영자 전용: 내용은 서버 허용표(private.app_workspace_has_feature)를 쓰는 기존 RLS만 준다.
 * 위젯은 내 기능 목록(app_my_features)에 telegram이 없으면 아무것도 읽지 않은 것처럼 '이 기능 없음'만 그린다.
 * 머리: '새 소식 n · 요청 n'(오늘 중요한 소식 수·텔레그램 '나한테 온 요청' 수), 줄: 최근 방 세 곳(방 이름 · 한 줄). 누르면 그 방·그 날.
 */
object WidgetTelegram {
    const val MAX_ROOMS = 3
    private const val MAX_LINE = 80
    private val ROOM_KEY = Regex("^[A-Za-z0-9_.:-]{1,100}$")

    data class Room(val key: String, val day: LocalDate, val text: String)

    data class Content(val enabled: Boolean, val head: String, val rooms: List<Room>, val note: String?)

    val NO_FEATURE = Content(false, "텔레그램", emptyList(), "이 기능 없음")

    fun today(nowMs: Long, zone: ZoneId = WidgetToday.ZONE): LocalDate = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()

    fun isRoomKey(value: String?): Boolean = value != null && ROOM_KEY.matches(value)

    /** 내 기능 목록(문자열 배열)에 telegram이 있는지. 모양이 다르면 null(읽지 못함). */
    fun hasFeature(status: Int, body: Any?): Boolean? {
        if (status != 200) return null
        val list = MiniJson.list(body) ?: return null
        return list.any { it == "telegram" }
    }

    private fun clip(value: String?): String {
        val t = (value ?: "").replace(Regex("[\\u0000-\\u001f\\u007f\\u2028\\u2029]+"), " ").trim()
        val cut = t.codePoints().limit(MAX_LINE.toLong()).toArray().let { String(it, 0, it.size) }.trim()
        return cut
    }

    /** 최근 소식(새것 먼저) → 방마다 가장 새 줄 하나, 세 곳까지. */
    fun rooms(body: Any?): List<Room> {
        val list = MiniJson.list(body) ?: return emptyList()
        val seen = LinkedHashMap<String, Room>()
        for (item in list) {
            val r = MiniJson.obj(item) ?: continue
            val key = MiniJson.str(r["room_key"])
            if (!isRoomKey(key) || seen.containsKey(key)) continue
            val day = MiniJson.str(r["day"])?.let { WidgetWeek.parseDay(it) } ?: continue
            val name = clip(MiniJson.str(r["room_label"])).ifEmpty { "이름 없는 방" }
            val line = clip(MiniJson.str(r["summary"])).ifEmpty { clip(MiniJson.str(r["title"])) }
            seen[key!!] = Room(key, day, if (line.isEmpty()) name else "$name · $line")
            if (seen.size >= MAX_ROOMS) break
        }
        return seen.values.toList()
    }

    /** 오늘 중요한 소식 수(app_feed_days kept_count). 오늘 줄이 없으면 0, 모양이 다르면 null. */
    fun kept(body: Any?): Int? {
        val list = MiniJson.list(body) ?: return null
        val first = MiniJson.obj(list.firstOrNull()) ?: return 0
        return MiniJson.num(first["kept_count"])?.toInt() ?: 0
    }

    /**
     * features·days·items: 차례로 기능 목록·오늘 건수·최근 소식 답. asks: 처리 전 후보에서 센 '나한테 온 요청'(못 읽었으면 null).
     * 기능이 없으면 NO_FEATURE. 기능 목록을 못 읽으면 null(위젯은 '불러오지 못했어요').
     */
    fun content(features: WidgetSession.Reply, days: WidgetSession.Reply?, items: WidgetSession.Reply?, asks: Int?): Content? {
        when (hasFeature(features.status, features.body)) {
            null -> return null
            false -> return NO_FEATURE
            true -> Unit
        }
        val n = if (days?.status == 200) kept(days.body) else null
        val head = "새 소식 ${n ?: "-"} · 요청 ${asks ?: "-"}"
        val rooms = if (items?.status == 200) rooms(items.body) else emptyList()
        val note = when {
            items?.status != 200 -> "소식을 읽지 못했어요"
            rooms.isEmpty() -> "어제·오늘 소식이 없어요"
            else -> null
        }
        return Content(true, head, rooms, note)
    }

    /** 앱 텔레그램 화면의 그 방·그 날(웹이 읽고 주소에서 지운다). */
    fun roomUrl(room: Room): String = roomUrl(room.key, room.day)

    fun roomUrl(key: String, day: LocalDate): String {
        require(isRoomKey(key))
        return ShellRules.HOME + "?view=telegram&tg_room=" + java.net.URLEncoder.encode(key, "UTF-8") + "&tg_day=" + day
    }

    /** 웹2가 이미 떠 있을 때 다리로 보내는 글(날짜·방 번호 둘 다 위에서 거른 모양). */
    fun roomMessage(key: String, day: LocalDate): String {
        require(isRoomKey(key))
        return "tg:open:$day:$key"
    }
}
