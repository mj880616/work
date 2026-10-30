package kr.or.kptu.work

import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 오늘 위젯에 그릴 줄을 만든다(설계 6절, D7). 안드로이드 API를 쓰지 않아 JVM 시험 대상이다.
 * 일정: 오늘 0시~내일 0시(서울). 할 일: 끝내지 않은 것 중 기한이 오늘이거나 지난 것.
 * 만든 줄은 폰에 저장하지 않는다(결정 W-D2). 홈 화면이 그린 그림만 들고 있다.
 */
object WidgetToday {
    val ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    const val MAX_EVENTS = 4
    const val MAX_TASKS = 4
    private const val MAX_TITLE = 80
    private val HHMM = DateTimeFormatter.ofPattern("HH:mm")
    private val DAYS = arrayOf("월", "화", "수", "목", "금", "토", "일")

    enum class Target { CALENDAR, TASKS }

    data class Row(val time: String, val title: String, val target: Target)

    /** counts: WIDGET-여러개 ② 맨 아래 '챙길 것 n · 나한테 온 요청 n' 줄(읽지 못했으면 null, 줄을 숨김). */
    data class Content(val title: String, val rows: List<Row>, val note: String?, val counts: String? = null)

    /** 처리 전 후보 건수. 웹 inbox-count.js의 openTodos·openAsks와 같은 규칙(이미 할 일이 된 제목은 빼기). */
    data class Counts(val todo: Int, val asks: Int) {
        fun line(): String = "챙길 것 $todo · 나한테 온 요청 $asks"
    }

    /**
     * 웹 /[\s\p{P}\p{S}]+/gu와 같은 글자들. 안드로이드 정규식(ICU)은 자바 전용 줄 안 표시 U(유니코드 글자 묶음)를 받지 않아(PatternSyntaxException)
     * 이 객체가 만들어지지 못하면 위젯 전체가 빈칸이 된다(FIX-위젯). 그래서 표시 없이 유니코드 공백(\p{Z}·FEFF)을 직접 적는다.
     */
    private val TITLE_NOISE = Regex("[\\s\\p{Z}\\uFEFF\\p{P}\\p{S}]+")

    /** 웹 todo-radar-data.js normalizeTitle과 같은 비교용 제목(소문자·NFKC·공백·문장부호·기호 빼기·80자). */
    fun normalizeTitle(value: String?): String {
        val t = java.text.Normalizer.normalize((value ?: "").lowercase(), java.text.Normalizer.Form.NFKC).replace(TITLE_NOISE, "")
        return if (t.length > 80) t.substring(0, 80) else t
    }

    /** 후보 목록(rest app_todo_candidates, 처리 전만)과 할 일 목록 → 건수. 목록 모양이 아니면 null. */
    fun counts(candidates: Any?, tasks: Any?): Counts? {
        val rows = MiniJson.list(candidates) ?: return null
        val known = HashSet<String>()
        MiniJson.list(MiniJson.obj(tasks)?.get("tasks"))?.forEach { item ->
            val t = MiniJson.obj(item) ?: return@forEach
            if (MiniJson.str(t["status"]) == "completed") return@forEach
            normalizeTitle(MiniJson.str(t["title"])).takeIf { it.isNotEmpty() }?.let(known::add)
        }
        var todo = 0
        var asks = 0
        for (item in rows) {
            val r = MiniJson.obj(item) ?: continue
            if (normalizeTitle(MiniJson.str(r["summary"])) in known) continue
            todo++
            if (MiniJson.str(r["source_kind"]) == "telegram") asks++
        }
        return Counts(todo, asks)
    }

    /** 오늘 0시와 내일 0시(서울)를 UTC 글(…Z)로. */
    fun range(nowMs: Long, zone: ZoneId = ZONE): Pair<String, String> {
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        val a = today.atStartOfDay(zone).toInstant()
        val b = today.plusDays(1).atStartOfDay(zone).toInstant()
        return a.toString() to b.toString()
    }

    fun header(nowMs: Long, zone: ZoneId = ZONE): String {
        val d = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        return "오늘 ${d.monthValue}.${d.dayOfMonth} ${DAYS[d.dayOfWeek.value - 1]}"
    }

    fun cleanTitle(value: String?): String {
        val t = (value ?: "").replace(Regex("[\\u0000-\\u001f\\u007f\\u2028\\u2029]+"), " ").trim()
        val cut = t.codePoints().limit(MAX_TITLE.toLong()).toArray().let { String(it, 0, it.size) }.trim()
        return cut.ifEmpty { "(제목 없음)" }
    }

    /** google-calendar action=events 응답 → 일정 줄. 종일 먼저, 그다음 시작 시각 순. */
    fun events(body: Any?, nowMs: Long, zone: ZoneId = ZONE): List<Row> {
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        val list = MiniJson.list(MiniJson.obj(body)?.get("events")) ?: return emptyList()
        data class E(val allDay: Boolean, val at: Long, val row: Row)
        val out = ArrayList<E>()
        for (item in list) {
            val e = MiniJson.obj(item) ?: continue
            val start = MiniJson.str(e["start"]) ?: continue
            val allDay = e["allDay"] == true
            val title = cleanTitle(MiniJson.str(e["title"]))
            if (allDay) {
                val d = parseDate(start) ?: continue
                out.add(E(true, d.toEpochDay(), Row("종일", title, Target.CALENDAR)))
            } else {
                val t = parseTime(start) ?: continue
                val local = t.atZoneSameInstant(zone)
                val label = if (local.toLocalDate().isBefore(today)) "계속" else local.format(HHMM)
                out.add(E(false, t.toInstant().toEpochMilli(), Row(label, title, Target.CALENDAR)))
            }
        }
        out.sortWith(compareBy<E>({ !it.allDay }, { it.at }))
        return out.map { it.row }
    }

    /** google-tasks action=overview 응답 → 할 일 줄. 지난 기한 먼저, 같은 날은 받은 순서. */
    fun tasks(body: Any?, nowMs: Long, zone: ZoneId = ZONE): List<Row> {
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        val list = MiniJson.list(MiniJson.obj(body)?.get("tasks")) ?: return emptyList()
        data class T(val due: LocalDate, val index: Int, val row: Row)
        val out = ArrayList<T>()
        list.forEachIndexed { i, item ->
            val t = MiniJson.obj(item) ?: return@forEachIndexed
            if (MiniJson.str(t["status"]) == "completed") return@forEachIndexed
            val due = MiniJson.str(t["due"])?.let { if (it.length >= 10) parseDate(it.substring(0, 10)) else null } ?: return@forEachIndexed
            if (due.isAfter(today)) return@forEachIndexed
            val label = if (due.isBefore(today)) "지남" else "오늘"
            out.add(T(due, i, Row(label, cleanTitle(MiniJson.str(t["title"])), Target.TASKS)))
        }
        out.sortWith(compareBy<T>({ it.due }, { it.index }))
        return out.map { it.row }
    }

    /** 응답 둘을 위젯 내용 하나로. 연결이 없거나 읽지 못한 쪽은 짧은 안내 한 줄. */
    fun content(raw: WidgetSession.Raw, nowMs: Long, zone: ZoneId = ZONE): Content {
        val notes = ArrayList<String>()
        val ev = if (raw.calendarStatus == 200) {
            val obj = MiniJson.obj(raw.calendar)
            val rows = events(raw.calendar, nowMs, zone)
            if (rows.isEmpty() && obj?.get("warning") != null) notes.add("일정을 읽지 못했어요")
            rows
        } else {
            notes.add("일정 연결을 확인해 주세요")
            emptyList()
        }
        val tk = if (raw.tasksStatus == 200) {
            val obj = MiniJson.obj(raw.tasks)
            when {
                obj?.get("connected") == false -> { notes.add("할 일 연결이 필요해요"); emptyList() }
                obj?.get("needs_reconnect") == true -> { notes.add("할 일을 다시 연결해 주세요"); emptyList() }
                else -> tasks(raw.tasks, nowMs, zone)
            }
        } else {
            notes.add("할 일을 읽지 못했어요")
            emptyList()
        }
        val rows = ArrayList<Row>()
        rows.addAll(more(ev, MAX_EVENTS, Target.CALENDAR, "일정"))
        rows.addAll(more(tk, MAX_TASKS, Target.TASKS, "할 일"))
        val note = when {
            notes.isNotEmpty() -> notes.joinToString(" · ")
            rows.isEmpty() -> "오늘 일정·할 일이 없어요"
            else -> null
        }
        // 후보 표가 아직 없으면(404) 웹처럼 0으로 센다. 그 밖의 실패·읽지 않음은 줄을 숨긴다.
        val counts = when (raw.candidatesStatus) {
            200 -> counts(raw.candidates, if (raw.tasksStatus == 200) raw.tasks else null)?.line()
            404 -> Counts(0, 0).line()
            else -> null
        }
        return Content(header(nowMs, zone), rows, note, counts)
    }

    private fun more(rows: List<Row>, max: Int, target: Target, word: String): List<Row> {
        if (rows.size <= max) return rows
        return rows.take(max - 1) + Row("", "$word ${rows.size - (max - 1)}개 더", target)
    }

    private fun parseDate(value: String): LocalDate? =
        try {
            LocalDate.parse(value.take(10))
        } catch (_: Exception) {
            null
        }

    private fun parseTime(value: String): OffsetDateTime? =
        try {
            OffsetDateTime.parse(value)
        } catch (_: Exception) {
            null
        }
}
