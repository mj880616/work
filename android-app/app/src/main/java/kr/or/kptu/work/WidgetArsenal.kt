package kr.or.kptu.work

import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.temporal.ChronoUnit

/**
 * WIDGET-여러개 ③: '아스날' 위젯(2×1)에 그릴 두 줄. 안드로이드 API를 쓰지 않아 JVM 시험 대상이다.
 * 자료: 앱 아스날 화면과 같은 공개 정적 파일 app/arsenal/matches.js(window.ARSENAL_MATCHES = [ … ]). 로그인 없이 읽는다.
 * 지금 파일에는 끝난 경기만 있다. 다음 경기는 점수가 없고 날짜가 오늘 이후인 줄이 생기면(선택: "kickoff":"HH:MM" 서울 시각) 그 줄을 쓴다.
 * 그런 줄이 없으면 '다음 경기 자료 준비 중' + 마지막 결과.
 */
object WidgetArsenal {
    const val ARSENAL = "아스날"
    private val DAYS = arrayOf("월", "화", "수", "목", "금", "토", "일")
    private val HHMM = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

    /** 앱 주소 ?match= 에 넣을 수 있는 경기 id 모양(웹 app-router PLACE_VALUE 안쪽 글자이면서 폰 앱 화면 안 이동 주소에 들어가는 글자, 80자까지). */
    val ID = Regex("^[A-Za-z0-9_.-]{1,80}$")

    data class Match(
        val date: LocalDate,
        val home: Boolean,
        val opponent: String,
        val competition: String,
        val kickoff: String?,
        val score: String?,
        val result: String?,
        val round: String = "",
        val broadcast: String? = null,
        val id: String = "",
        val review: String? = null,
        val goals: List<Goal> = emptyList(),
    )

    /** 아스날이 넣은 골 한 개(APP-아스날위젯알차게 ④). 자책골은 상대 선수 이름이라 '자책골'로만 적는다. */
    data class Goal(val minute: String, val scorer: String, val type: String)

    data class Content(val top: String, val bottom: String)

    /** "window.ARSENAL_MATCHES = [ … ];" → 경기 목록. 모양이 다르면 null. */
    fun parse(text: String?): List<Match>? {
        val t = text ?: return null
        val a = t.indexOf('[')
        val b = t.lastIndexOf(']')
        if (a < 0 || b <= a || !t.substring(0, a).contains("ARSENAL_MATCHES")) return null
        val list = MiniJson.list(MiniJson.parse(t.substring(a, b + 1))) ?: return null
        val out = ArrayList<Match>()
        for (item in list) {
            val m = MiniJson.obj(item) ?: continue
            val date = WidgetWeek.parseDay(MiniJson.str(m["date"])) ?: continue
            val home = MiniJson.str(m["home"]) ?: continue
            val away = MiniJson.str(m["away"]) ?: continue
            val isHome = home == ARSENAL
            if (!isHome && away != ARSENAL) continue
            val hs = MiniJson.num(m["homeScore"])?.toInt()
            val aw = MiniJson.num(m["awayScore"])?.toInt()
            val score = if (hs != null && aw != null) (if (isHome) "$hs-$aw" else "$aw-$hs") else null
            val kickoff = MiniJson.str(m["kickoff"])?.takeIf { HHMM.matches(it) }
            val broadcast = MiniJson.str(m["broadcast"])?.trim()?.takeIf { it.isNotEmpty() && it.length <= 40 }
            val id = MiniJson.str(m["id"])?.takeIf { ID.matches(it) } ?: ""
            val review = firstSentence(MiniJson.str(m["subtitle"]) ?: MiniJson.str(m["verdict"]))
            val ourSide = if (isHome) "home" else "away"
            val goals = MiniJson.list(m["goals"]).orEmpty().mapNotNull { g ->
                val o = MiniJson.obj(g) ?: return@mapNotNull null
                if (MiniJson.str(o["side"]) != ourSide) return@mapNotNull null
                val minute = MiniJson.str(o["minute"])?.trim()?.takeIf { it.isNotEmpty() && it.length <= 8 } ?: return@mapNotNull null
                Goal(minute, MiniJson.str(o["scorer"])?.trim().orEmpty(), MiniJson.str(o["type"]) ?: "goal")
            }
            out.add(
                Match(
                    date, isHome, if (isHome) away else home, MiniJson.str(m["competition"]) ?: "", kickoff, score,
                    MiniJson.str(m["result"]), MiniJson.str(m["round"]) ?: "", broadcast, id, review, goals,
                ),
            )
        }
        return out
    }

    private fun day(d: LocalDate): String = "${d.monthValue}.${d.dayOfMonth}(${DAYS[d.dayOfWeek.value - 1]})"

    fun content(matches: List<Match>?, today: LocalDate): Content {
        if (matches == null) return Content("아스날", "불러오지 못했어요")
        val next = matches.filter { it.score == null && !it.date.isBefore(today) }.minByOrNull { it.date }
        val last = matches.filter { it.score != null }.maxByOrNull { it.date }
        val top = if (next != null) {
            "다음 ${day(next.date)}${next.kickoff?.let { " $it" } ?: ""} ${if (next.home) "홈" else "원정"} ${next.opponent}"
        } else {
            "다음 경기 자료 준비 중"
        }
        val bottom = if (last != null) {
            "지난 ${day(last.date)} ${if (last.home) "홈" else "원정"} ${last.opponent} ${last.score}${last.result?.let { " $it" } ?: ""}"
        } else {
            "지난 경기 없음"
        }
        return Content(top, bottom)
    }

    // ── APP-위젯아스날맞춤 B(S47-63): 4×2·4×1 위젯이 쓸 순수 계산. 그리는 쪽(ArsenalWidget·레이아웃)은 C에서 붙인다. ──
    // 기준: docs/design/arsenal-widget-remaining.md 4절 B, 5절 결정 ②(끝나는 시각)·⑤(중계 없으면 비움)·⑥(FotMob 팀 페이지).

    /** 결정 ⑥: 경기별 주소 자료가 없으므로 FotMob 아스날 팀 페이지 고정. 버튼은 C에서 붙인다. */
    const val FOTMOB_URL = "https://www.fotmob.com/teams/9825/overview/arsenal"

    /** 결정 ②: 보통 경기 = 킥오프 + 2시간(전후반·휴식·추가시간). */
    const val MATCH_MINUTES = 120L

    /** 결정 ②: 연장·승부차기가 가능한 컵 경기 = 킥오프 + 2시간 30분. */
    const val CUP_MATCH_MINUTES = 150L

    private val CUPS = setOf("Carabao Cup", "FA Cup")

    /** 다음 경기: 점수가 없고 오늘 이후인 줄 중 가장 가까운 것(같은 날이면 이른 킥오프). */
    fun next(matches: List<Match>?, today: LocalDate): Match? =
        matches.orEmpty()
            .filter { it.score == null && !it.date.isBefore(today) }
            .minWithOrNull(compareBy<Match>({ it.date }, { it.kickoff ?: "99:99" }))

    /** 'D-day'(오늘), 'D-1', 'D-3' … 지난 날짜면 null. */
    fun dDay(match: Match, today: LocalDate): String? {
        val n = ChronoUnit.DAYS.between(today, match.date)
        return when {
            n < 0 -> null
            n == 0L -> "D-day"
            else -> "D-$n"
        }
    }

    /** 연장·승부차기가 있을 수 있는 경기: 국내 컵 두 개, 챔피언스리그는 리그 페이즈가 아닌 녹아웃 라운드. */
    fun mayGoToExtraTime(match: Match): Boolean =
        match.competition in CUPS ||
            (match.competition == "UEFA Champions League" && match.round.isNotBlank() && !match.round.startsWith("League Phase"))

    /** 킥오프(한국 시각) 날짜·시각. 킥오프가 없으면 null. */
    fun kickoffAt(match: Match): LocalDateTime? {
        val k = match.kickoff ?: return null
        val h = k.substring(0, 2).toIntOrNull() ?: return null
        val m = k.substring(3, 5).toIntOrNull() ?: return null
        return LocalDateTime.of(match.date, LocalTime.of(h, m))
    }

    /** 끝나는 시각(한국 시각) = 킥오프 + 2시간, 컵 연장 가능 경기 + 2시간 30분. 킥오프가 없으면 null. */
    fun endAt(match: Match): LocalDateTime? =
        kickoffAt(match)?.plusMinutes(if (mayGoToExtraTime(match)) CUP_MATCH_MINUTES else MATCH_MINUTES)

    /**
     * '다음 날 첫 일정'을 볼 날: 경기가 정오 전에 끝나면(새벽 경기) 그날 아침, 정오 이후에 끝나면 이튿날.
     * 예) 01:30 킥오프 → 03:30 끝 → 같은 날 / 21:00 킥오프 → 23:00 끝 → 다음 날.
     */
    fun wakeDay(end: LocalDateTime): LocalDate = if (end.hour < 12) end.toLocalDate() else end.toLocalDate().plusDays(1)

    /**
     * 끝난 뒤의 첫 일정 시작: [starts](시간 있는 일정의 시작, 한국 시각. 하루 종일 일정은 넣지 않음) 중
     * [wakeDay] 날짜에 있고 끝나는 시각 이후인 가장 이른 것. 없으면 null.
     */
    fun firstAfter(end: LocalDateTime, starts: List<LocalDateTime>): LocalDateTime? {
        val day = wakeDay(end)
        return starts.filter { it.toLocalDate() == day && it.isAfter(end) }.minOrNull()
    }

    /** 끝나는 시각부터 첫 일정까지 잘 수 있는 시간(시간 단위, 내림). 첫 일정이 없으면 null. */
    fun sleepHours(end: LocalDateTime, first: LocalDateTime?): Long? {
        val f = first ?: return null
        if (!f.isAfter(end)) return 0L
        return Duration.between(end, f).toHours()
    }

    /** 10/31 확정 문구: '생중계 보면 잠 n시간'. 첫 일정이 없으면 null(줄 생략). */
    fun sleepText(end: LocalDateTime, first: LocalDateTime?): String? =
        sleepHours(end, first)?.let { "생중계 보면 잠 ${it}시간" }

    /** 끝난 경기 한 줄의 승·무·패. result 칸이 있으면 그대로(승부차기 패 등), 없으면 점수로. */
    fun outcome(match: Match): String? {
        match.result?.takeIf { it == "승" || it == "무" || it == "패" }?.let { return it }
        val s = match.score ?: return null
        val dash = s.indexOf('-')
        if (dash <= 0) return null
        val us = s.substring(0, dash).toIntOrNull() ?: return null
        val them = s.substring(dash + 1).toIntOrNull() ?: return null
        return when {
            us > them -> "승"
            us < them -> "패"
            else -> "무"
        }
    }

    /** 최근 다섯 경기 승·무·패, 오래된 경기 → 최근 경기 순(왼쪽부터 읽음). 끝난 경기가 적으면 있는 만큼. */
    fun form(matches: List<Match>?, count: Int = 5): List<String> =
        matches.orEmpty()
            .filter { it.score != null }
            .sortedByDescending { it.date }
            .mapNotNull { outcome(it) }
            .take(count)
            .reversed()

    /** 글자 동그라미에 넣을 상대 팀 첫 글자(엠블럼 그림 안 씀). 영문은 대문자. 이름이 비면 '?'. */
    fun initial(name: String): String {
        val t = name.trim()
        if (t.isEmpty()) return "?"
        val cp = t.codePointAt(0)
        return String(Character.toChars(Character.toUpperCase(cp)))
    }

    // ── APP-위젯아스날맞춤 C·D·E(S48-2b): 크기별 모양·내 일정·[달력에 넣기]·결과 가림. 그리는 쪽은 ArsenalWidget. ──

    /** 크기별 모양(결정 ①: 4×2·4×1·2×1, 2×2 없음). */
    enum class Size { SMALL, WIDE, BIG }

    /** 넓이·높이(dp) 기준. 폴드 바깥 화면 4칸이 250dp보다 좁을 수 있어 넓은 모양은 200dp부터. */
    const val WIDE_FROM_DP = 200
    const val BIG_FROM_DP = 100

    /** 4×2에서 리뷰 첫 문장 줄까지 넣을 높이(APP-아스날위젯알차게). 그보다 낮으면 리뷰 줄만 뺀다. */
    const val TALL_FROM_DP = 140

    /** 같은 모양 안에서 '높은 칸'인지: 2×2(작은 모양 100dp 이상)는 최근 5경기 칸을, 4×2 140dp 이상은 리뷰 줄을 더한다. */
    fun tall(size: Size, heightDp: Int): Boolean = when (size) {
        Size.SMALL -> heightDp >= BIG_FROM_DP
        Size.BIG -> heightDp >= TALL_FROM_DP
        Size.WIDE -> false
    }

    /** 홈 화면 칸 크기(dp) → 모양. 4×2 = BIG, 4×1 = WIDE, 그보다 좁으면(2×1·2×2) SMALL. */
    fun size(widthDp: Int, heightDp: Int): Size = when {
        widthDp < WIDE_FROM_DP -> Size.SMALL
        heightDp >= BIG_FROM_DP -> Size.BIG
        else -> Size.WIDE
    }

    private val COMPETITIONS = mapOf(
        "Premier League" to "프리미어리그",
        "UEFA Champions League" to "챔피언스리그",
        "Carabao Cup" to "카라바오컵",
        "FA Cup" to "FA컵",
    )

    fun competitionName(match: Match): String {
        val c = COMPETITIONS[match.competition] ?: match.competition
        val r = match.round.takeUnless { it.isBlank() || it.startsWith("League Phase") } ?: ""
        return listOf(c, r).filter { it.isNotBlank() }.joinToString(" ")
    }

    private fun clock(t: LocalDateTime): String = "%02d:%02d".format(t.hour, t.minute)

    /** [달력에 넣기]로 폰 달력 '일정 추가' 화면에 미리 채울 내용(결정 ③, 서버 쓰기 없음). 시각은 epoch ms. */
    data class Draft(val title: String, val beginMs: Long, val endMs: Long, val description: String)

    fun draft(match: Match, zone: java.time.ZoneId = WidgetNow.ZONE): Draft? {
        val start = kickoffAt(match) ?: return null
        val end = endAt(match) ?: return null
        val side = if (match.home) "홈" else "원정"
        val desc = listOfNotNull(competitionName(match).ifBlank { null }, match.broadcast?.let { "중계 $it" }).joinToString(" · ")
        return Draft(
            "아스날 경기 · $side ${match.opponent}",
            start.atZone(zone).toInstant().toEpochMilli(),
            end.atZone(zone).toInstant().toEpochMilli(),
            desc,
        )
    }

    /** 폰 달력 '일정 추가' 화면(CalendarContract)이 읽는 이름 그대로: title·beginTime·endTime·description. */
    fun calendarExtras(d: Draft): Map<String, Any> =
        linkedMapOf("title" to d.title, "beginTime" to d.beginMs, "endTime" to d.endMs, "description" to d.description)

    /** 폰 달력 앱 '일정 추가' 화면 주소(CalendarContract.Events.CONTENT_URI와 같은 글). */
    const val CALENDAR_INSERT_URI = "content://com.android.calendar/events"

    /** 다음 경기 뒤 '내 일정'을 볼 하루(서울 0시~다음 0시). 킥오프가 없으면 null. 위젯 로그인 허용 범위(calendarUrl) 안의 글로 낸다. */
    fun wakeRange(match: Match?, zone: java.time.ZoneId = WidgetNow.ZONE): Pair<String, String>? {
        val end = match?.let(::endAt) ?: return null
        val day = wakeDay(end)
        return day.atStartOfDay(zone).toInstant().toString() to day.plusDays(1).atStartOfDay(zone).toInstant().toString()
    }

    /** 끝난 뒤 첫 일정(시간 있는 일정만). [firstAfter]와 같은 규칙에 제목을 붙인다. */
    fun firstEvent(end: LocalDateTime, events: List<WidgetNow.Ev>, zone: java.time.ZoneId = WidgetNow.ZONE): Pair<LocalDateTime, String>? {
        val timed = events.filter { !it.allDay }.map {
            java.time.Instant.ofEpochMilli(it.startMs).atZone(zone).toLocalDateTime() to it.title
        }
        val first = firstAfter(end, timed.map { it.first }) ?: return null
        return timed.first { it.first == first }
    }

    /** 내 일정 상태: 위젯 로그인이 없음 / 읽지 못함 / 읽음(그 하루 일정). */
    sealed class Mine {
        object SignedOut : Mine()
        object Failed : Mine()
        data class Read(val events: List<WidgetNow.Ev>) : Mine()
    }

    /** 위젯 한 개가 그릴 글 전부. 빈 글이 없게 채운다(빈칸 없이). null인 줄은 그 줄을 생략. */
    data class Card(
        val initial: String,
        val title: String,
        val sub: String,
        val dDay: String?,
        val broadcast: String?,
        val after: String,
        val sleep: String?,
        val form: List<String>,
        val formNote: String?,
        val wideTop: String,
        val wideBottom: String,
        val lastInitial: String,
        val lastTop: String,
        val lastBottom: String,
        val draft: Draft?,
    )

    const val HIDDEN_LINE = "결과 가림 · 누르면 보기"
    const val HIDDEN_FORM = "최근 결과 가림"
    const val SIGNED_OUT_MINE = "위젯 로그인하면 경기 뒤 내 일정"

    /** 자료가 아직 없거나 못 읽었을 때: 모든 줄을 같은 한 줄로(빈칸 없이). */
    fun placeholder(text: String): Card = Card(
        "A", ARSENAL, text, null, null, text, null, emptyList(), null, ARSENAL, text, "A", ARSENAL, text, null,
    )

    fun card(matches: List<Match>, today: LocalDate, mine: Mine, hide: Boolean): Card {
        val nx = next(matches, today)
        val last = matches.filter { it.score != null }.maxByOrNull { it.date }
        val form = if (hide) emptyList() else form(matches)
        val formNote = when {
            hide -> HIDDEN_FORM
            form.isEmpty() -> "지난 경기 없음"
            else -> null
        }
        val lastTop = last?.let { "지난 ${day(it.date)} ${if (it.home) "홈" else "원정"} ${it.opponent}" } ?: "지난 경기 없음"
        val lastBottom = when {
            last == null -> "다음 경기를 기다려요"
            hide -> HIDDEN_LINE
            else -> "${last.score}${outcome(last)?.let { " $it" } ?: ""} · ${competitionName(last)}".trimEnd(' ', '·')
        }
        val lastInitial = last?.let { initial(it.opponent) } ?: "A"
        if (nx == null) {
            return Card(
                "A", "다음 경기 자료 준비 중", lastTop, null, null,
                if (hide || last == null) lastTop else "$lastTop ${last.score}", null, form, formNote,
                "다음 경기 자료 준비 중", if (hide || last == null) lastTop else "$lastTop ${last.score}",
                lastInitial, lastTop, lastBottom, null,
            )
        }
        val side = if (nx.home) "홈" else "원정"
        val whenText = "${day(nx.date)}${nx.kickoff?.let { " $it" } ?: ""}"
        val comp = competitionName(nx)
        val end = endAt(nx)
        var sleep: String? = null
        val after = when {
            end == null -> "킥오프 시각 준비 중"
            mine is Mine.SignedOut -> "끝 ${clock(end)} · $SIGNED_OUT_MINE"
            mine is Mine.Failed -> "끝 ${clock(end)} · 내 일정 불러오지 못했어요"
            else -> {
                val label = if (wakeDay(end) == end.toLocalDate()) "아침" else "다음 날"
                val first = firstEvent(end, (mine as Mine.Read).events)
                sleep = sleepText(end, first?.first)
                if (first == null) "끝 ${clock(end)} → $label 첫 일정 없음" else "끝 ${clock(end)} → $label 첫 일정 ${clock(first.first)} ${first.second}"
            }
        }
        val dd = dDay(nx, today)
        return Card(
            initial(nx.opponent),
            "$side ${nx.opponent}",
            listOf(comp, whenText).filter { it.isNotBlank() }.joinToString(" · "),
            dd,
            nx.broadcast?.let { "중계 $it" },
            after,
            sleep,
            form,
            formNote,
            listOfNotNull(dd, "$side ${nx.opponent}").joinToString(" "),
            listOfNotNull(whenText, comp.ifBlank { null }, nx.broadcast).joinToString(" · "),
            lastInitial,
            lastTop,
            lastBottom,
            draft(nx),
        )
    }

    // ── APP-아스날위젯알차게(S48-55): 4×2를 빈칸 없이 — ① 최근 5경기 칸 ③ 지난 경기 + 리뷰 첫 문장(누르면 그 리뷰)
    //    ④ 경기 끝나면 다음 날 저녁까지 결과·골 넣은 선수 ⑤ 다음 3경기 ⑥ 팀 줄임 글자 동그라미·대회 표·홈/원정 표시.
    //    ② 리그 순위는 새 외부 자료처가 필요해 이번 판에서 뺐다(새 외부 주소 추가 금지). 엠블럼 그림도 자료(matches.js)에 주소가
    //    없고 새 외부 주소를 부를 수 없어, 요청함이 정한 대체안인 줄임 글자 동그라미(ARS·LIV)로 그린다(폰에 그림 저장 없음).

    /** 리뷰 첫 문장: 마침표·물음표·느낌표 뒤 빈칸에서 끊는다(2.5 같은 숫자는 안 끊김). 너무 길면 120자에서 자른다. */
    fun firstSentence(text: String?): String? {
        val t = text?.trim()?.replace(Regex("\\s+"), " ") ?: return null
        if (t.isEmpty()) return null
        val m = Regex("[.!?](\\s|$)").find(t)
        val one = if (m != null) t.substring(0, m.range.first + 1) else t
        return if (one.length > 120) one.take(119) + "…" else one
    }

    const val ARS_CODE = "ARS"

    /** 자주 만나는 팀의 줄임 글자(방송·순위표에서 쓰는 세 글자). 없는 팀은 경기 id의 영문 이름 앞 세 글자, 그것도 없으면 첫 글자. */
    private val CODES = mapOf(
        "리버풀" to "LIV", "첼시" to "CHE", "맨체스터 시티" to "MCI", "맨체스터 유나이티드" to "MUN", "토트넘 홋스퍼" to "TOT",
        "뉴캐슬 유나이티드" to "NEW", "아스톤 빌라" to "AVL", "웨스트햄 유나이티드" to "WHU", "크리스털 팰리스" to "CRY",
        "노팅엄 포리스트" to "NFO", "브라이튼" to "BHA", "브라이튼 앤 호브 앨비언" to "BHA", "브라이턴 앤드 호브 앨비언" to "BHA",
        "울버햄프턴" to "WOL", "울버햄프턴 원더러스" to "WOL", "본머스" to "BOU", "브렌트퍼드" to "BRE", "풀럼" to "FUL",
        "에버턴" to "EVE", "리즈 유나이티드" to "LEE", "선덜랜드" to "SUN", "번리" to "BUR", "헐 시티" to "HUL",
        "입스위치 타운" to "IPS", "코번트리" to "COV", "플리트우드 타운" to "FLE", "슬라비아 프라하" to "SLA",
        "바이에른 뮌헨" to "BAY", "파리 생제르맹" to "PSG", "인터 밀란" to "INT", "아틀레티코 마드리드" to "ATM",
        "아틀레틱 클루브" to "ATH", "바이어 레버쿠젠" to "LEV", "스포르팅 CP" to "SCP", "클뤼프 브뤼허" to "BRU",
        "나폴리" to "NAP", "올림피아코스" to "OLY", "카이라트 알마티" to "KAI", "릴" to "LIL",
    )
    private val DATED_ID = Regex("^\\d{4}-\\d{2}-\\d{2}-([a-z]+)")

    fun code(match: Match): String {
        CODES[match.opponent.trim()]?.let { return it }
        val word = DATED_ID.find(match.id)?.groupValues?.get(1)
        if (word != null && word.length >= 3) return word.take(3).uppercase()
        return initial(match.opponent)
    }

    /** 대회 작은 표: 프리미어리그 PL · 챔피언스리그 UCL · 카라바오컵 EFL · FA컵 FA. 모르는 대회는 앞 세 글자. */
    fun tag(match: Match): String = when (match.competition) {
        "Premier League" -> "PL"
        "UEFA Champions League" -> "UCL"
        "Carabao Cup" -> "EFL"
        "FA Cup" -> "FA"
        else -> match.competition.trim().take(3).uppercase().ifEmpty { "-" }
    }

    /** 홈/원정 표시(글자 안 아이콘). */
    fun side(match: Match): String = if (match.home) "⌂홈" else "✈원정"

    /** 골 넣은 선수 한 줄: 'Havertz 16\', Saka 12\' 71\''. 같은 선수는 한 번만 쓰고 분을 잇는다. 페널티는 (PK), 자책골은 '자책골'. */
    fun scorers(match: Match): String? {
        if (match.goals.isEmpty()) return null
        val order = LinkedHashMap<String, MutableList<String>>()
        for (g in match.goals) {
            val name = if (g.type == "own-goal") "자책골" else g.scorer.split(' ').lastOrNull { it.isNotBlank() } ?: "?"
            order.getOrPut(name) { mutableListOf() }.add(g.minute + "'" + if (g.type == "penalty") "(PK)" else "")
        }
        return order.entries.joinToString(", ") { (name, mins) -> "$name ${mins.joinToString(" ")}" }
    }

    /** ④ 결과를 먼저 보여 줄 마지막 시각: 경기 날(서울) 다음 날 저녁 9시. */
    fun resultUntil(match: Match): LocalDateTime = LocalDateTime.of(match.date.plusDays(1), LocalTime.of(21, 0))

    /** 방금 끝난 경기(④): 가장 최근 끝난 경기가 경기 날 0시 ~ 다음 날 21시 안이면 그 경기. */
    fun justFinished(matches: List<Match>, now: LocalDateTime): Match? {
        val last = matches.filter { it.score != null }.maxByOrNull { it.date } ?: return null
        if (now.isBefore(last.date.atStartOfDay()) || now.isAfter(resultUntil(last))) return null
        return last
    }

    /** 다음 경기 작은 칸(⑤). */
    data class Mini(val whenText: String, val tag: String, val side: String, val code: String, val name: String)

    private fun mini(m: Match): Mini =
        Mini("${m.date.monthValue}.${m.date.dayOfMonth}${m.kickoff?.let { " $it" } ?: "(${DAYS[m.date.dayOfWeek.value - 1]})"}", tag(m), if (m.home) "⌂" else "✈", code(m), m.opponent)

    /** 점수 없는 오늘 이후 경기, 가까운 순. */
    fun upcoming(matches: List<Match>, today: LocalDate): List<Match> =
        matches.filter { it.score == null && !it.date.isBefore(today) }
            .sortedWith(compareBy<Match>({ it.date }, { it.kickoff ?: "99:99" }))

    /**
     * 4×2(큰 칸)·4×1·2×1이 그릴 내용 전부. 기존 [Card](다음 경기·내 일정·[달력에 넣기])에 이번 과제의 줄을 더한다.
     * post = 방금 끝난 경기 결과를 맨 위에(결과 가림이면 절대 켜지 않음).
     */
    data class Rich(
        val card: Card,
        val post: Boolean,
        val headCode: String?,
        val headTag: String?,
        val headSide: String?,
        val title: String,
        val sub: String,
        val badge: String?,
        val line2: String,
        val sleep: String?,
        val formLine: String,
        val review: String?,
        val reviewId: String?,
        val next3: List<Mini>,
        val wideTop: String,
        val wideBottom: String,
        val smallTop: String,
        val smallBottom: String,
    )

    /** 자료가 아직 없거나 못 읽었을 때(빈칸 없이 같은 한 줄). */
    fun richPlaceholder(text: String): Rich {
        val c = placeholder(text)
        return Rich(c, false, null, null, null, ARSENAL, text, null, text, null, text, null, null, emptyList(), ARSENAL, text, ARSENAL, text)
    }

    fun rich(matches: List<Match>, now: LocalDateTime, mine: Mine, hide: Boolean): Rich {
        val today = now.toLocalDate()
        val c = card(matches, today, mine, hide)
        val ups = upcoming(matches, today)
        val nx = ups.firstOrNull()
        val last = matches.filter { it.score != null }.maxByOrNull { it.date }
        val done = if (hide) null else justFinished(matches, now)
        val reviewText = last?.review?.let { if (hide) HIDDEN_LINE else "“$it”" }
        val reviewId = last?.id?.takeIf { it.isNotEmpty() }
        val lastShort = last?.let { "지난 ${it.date.monthValue}.${it.date.dayOfMonth} ${tag(it)} ${if (it.home) "홈" else "원정"} ${it.opponent}" + if (hide) "" else " ${it.score}" }
        val nextShort = nx?.let { listOfNotNull("다음", dDay(it, today), "${if (it.home) "홈" else "원정"} ${it.opponent}", it.kickoff?.let { k -> "${day(it.date)} $k" } ?: day(it.date)).joinToString(" ") }
        if (done != null) {
            val o = outcome(done)
            val goals = scorers(done) ?: if (done.score?.startsWith("0-") == true) "아스날 득점 없음" else "골 기록 준비 중"
            val headline = "${if (done.home) "홈" else "원정"} ${done.opponent} ${done.score}${o?.let { " $it" } ?: ""}"
            return Rich(
                c, true, code(done), tag(done), side(done), headline,
                listOf(competitionName(done), day(done.date)).filter { it.isNotBlank() }.joinToString(" · "),
                "결과", "⚽ $goals", null,
                nextShort ?: "다음 경기 자료 준비 중",
                reviewText, reviewId, ups.take(3).map(::mini),
                headline, "⚽ $goals",
                "${done.opponent} ${done.score}${o?.let { " $it" } ?: ""}", "⚽ $goals",
            )
        }
        return Rich(
            c, false, nx?.let(::code), nx?.let(::tag), nx?.let(::side), c.title, c.sub, c.dDay,
            listOfNotNull(c.after, c.broadcast).joinToString(" · "), c.sleep,
            lastShort ?: "지난 경기 없음",
            reviewText, reviewId, ups.drop(1).take(3).map(::mini),
            c.wideTop, c.wideBottom, c.lastTop, c.lastBottom,
        )
    }
}
