package kr.or.kptu.work

import android.app.Activity
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.CalendarContract
import android.util.SizeF
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.RemoteViews
import android.widget.TextView

/**
 * 홈 화면 '아스날' 위젯(APP-위젯아스날맞춤 C·D·E). 같은 위젯 이름을 유지하고 칸 크기에 따라 모양 셋 중 하나를 그린다(결정 ①).
 * - 4×2: 다음 경기(글자 동그라미·홈/원정·상대·대회·한국 시각·D-n·중계), '경기 끝나고 내 일정'(끝나는 시각 → 첫 일정, '생중계 보면 잠 n시간'),
 *   [달력에 넣기](폰 달력 앱 '일정 추가' 화면을 미리 채워 엶, 서버 쓰기 없음 — 결정 ③)·[FotMob로 보기](팀 페이지 고정 주소 — 결정 ⑥).
 * - 4×1: 최근 다섯 경기 승·무·패 + 다음 경기 한 줄. 2×1: 지난 경기 결과(결과 가림이면 '결과 가림 · 누르면 보기').
 * 경기 자료는 공개 정적 파일(WidgetRules.ARSENAL, 로그인 없이 6시간에 한 번), 내 일정은 위젯 로그인이 있을 때만 허용된 calendarUrl로 그 하루만 읽는다.
 * 받은 자료는 이 프로세스 메모리에만 둔다(폰에 저장하지 않음, W-D2). 폰에 두는 것은 위젯 번호별 '결과 가림' 켬/끔 설정 하나뿐(결정 ④).
 */
class ArsenalWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        draw(context, manager, ids)
        WidgetJobs.schedule(context)
        if (matches == null) WidgetJobs.refreshNow(context)
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle?) {
        // 안드로이드 11 이하: 크기를 바꾸면 그 크기에 맞는 모양으로 다시 그린다(12부터는 홈 화면이 크기별 그림에서 고름).
        WidgetGuard.run { draw(context, manager, intArrayOf(id)) }
    }

    override fun onEnabled(context: Context) {
        WidgetJobs.schedule(context)
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        val edit = prefs(context).edit()
        ids.forEach { edit.remove(hideKey(it)) }
        edit.apply()
    }

    override fun onDisabled(context: Context) {
        if (!HomeWidgets.anyRefreshed(context)) WidgetJobs.cancel(context)
        matches = null
        fetchedAt = 0L
        mine = WidgetArsenal.Mine.SignedOut
    }

    companion object {
        const val EVERY_MS = 6 * 60 * 60 * 1000L

        /** '결과 가림' 켬/끔을 두는 앱 전용 설정 파일(sharedpref는 백업·새 폰 옮기기에서 빠짐). 경기·일정 자료는 두지 않는다. */
        const val PREFS = "widget_arsenal"

        private val SMALL = SizeF(110f, 40f)
        private val WIDE = SizeF(WidgetArsenal.WIDE_FROM_DP.toFloat(), 40f)
        private val BIG = SizeF(WidgetArsenal.WIDE_FROM_DP.toFloat(), WidgetArsenal.BIG_FROM_DP.toFloat())
        private val SMALL_TALL = SizeF(110f, WidgetArsenal.BIG_FROM_DP.toFloat())
        private val TALL = SizeF(WidgetArsenal.WIDE_FROM_DP.toFloat(), WidgetArsenal.TALL_FROM_DP.toFloat())

        @Volatile private var matches: List<WidgetArsenal.Match>? = null
        @Volatile private var fetchedAt = 0L
        @Volatile private var failed = false
        @Volatile private var mine: WidgetArsenal.Mine = WidgetArsenal.Mine.SignedOut

        fun hasWidgets(context: Context): Boolean =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, ArsenalWidget::class.java)).isNotEmpty()

        private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        fun hideKey(id: Int): String = "hide.$id"

        fun hidden(context: Context, id: Int): Boolean = prefs(context).getBoolean(hideKey(id), false)

        fun setHidden(context: Context, id: Int, hide: Boolean) {
            prefs(context).edit().putBoolean(hideKey(id), hide).apply()
            val manager = AppWidgetManager.getInstance(context)
            draw(context, manager, intArrayOf(id))
        }

        /**
         * 같은 갱신 작업이 부른다. 경기 자료는 6시간 안에 받은 것이 있으면 다시 받지 않는다.
         * 내 일정: 다음 경기의 끝나는 시각이 있고 위젯 로그인이 있을 때만, 허용된 calendarUrl 모양으로 그 하루만 읽는다.
         */
        fun refresh(context: Context, session: WidgetSession, nowMs: Long) {
            if (matches == null || nowMs - fetchedAt >= EVERY_MS) {
                val r = session.readPublic(WidgetRules.ARSENAL)
                val parsed = if (r is WidgetSession.Outcome.Ok && r.value.status == 200) WidgetArsenal.parse(r.value.body as? String) else null
                if (parsed != null) {
                    matches = parsed
                    fetchedAt = nowMs
                    failed = false
                } else {
                    failed = matches == null
                }
            }
            mine = WidgetGuard.get { readMine(session) } ?: WidgetArsenal.Mine.Failed
            redraw(context)
        }

        private fun readMine(session: WidgetSession): WidgetArsenal.Mine {
            val today = java.time.LocalDate.now(WidgetNow.ZONE)
            val range = WidgetArsenal.wakeRange(WidgetArsenal.next(matches, today)) ?: return WidgetArsenal.Mine.Read(emptyList())
            if (!session.signedIn()) return WidgetArsenal.Mine.SignedOut
            return when (val r = session.readList(listOf(WidgetRules.calendarUrl(range.first, range.second)))) {
                is WidgetSession.Outcome.Ok -> {
                    val reply = r.value.singleOrNull()
                    if (reply == null || reply.status != 200) WidgetArsenal.Mine.Failed else WidgetArsenal.Mine.Read(WidgetNow.events(reply.body))
                }
                is WidgetSession.Outcome.SignedOut -> WidgetArsenal.Mine.SignedOut
                is WidgetSession.Outcome.Failed -> WidgetArsenal.Mine.Failed
            }
        }

        /** 갱신 작업이 실패로 끝났을 때(FIX-위젯). 받은 자료가 있으면 그것을, 없으면 '불러오지 못했어요'. */
        fun showFailed(context: Context) {
            if (matches == null) failed = true
            redraw(context)
        }

        private fun redraw(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, ArsenalWidget::class.java))
            if (ids.isNotEmpty()) draw(context, manager, ids)
        }

        /** 지금 그릴 글(메모리의 마지막 자료). 내용 만들기가 실패해도 빈칸 대신 '불러오지 못했어요'. */
        private fun rich(hide: Boolean): WidgetArsenal.Rich {
            val list = matches
            return WidgetGuard.get {
                val now = java.time.LocalDateTime.now(WidgetNow.ZONE)
                when {
                    list != null -> WidgetArsenal.rich(list, now, mine, hide)
                    failed -> WidgetArsenal.richPlaceholder("불러오지 못했어요")
                    else -> WidgetArsenal.richPlaceholder("불러오는 중")
                }
            } ?: WidgetArsenal.richPlaceholder("불러오지 못했어요")
        }

        private fun draw(context: Context, manager: AppWidgetManager, ids: IntArray) {
            for (id in ids) {
                val r = rich(WidgetGuard.get { hidden(context, id) } == true)
                val views = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    RemoteViews(
                        mapOf(
                            SMALL to build(context, WidgetArsenal.Size.SMALL, false, r),
                            SMALL_TALL to build(context, WidgetArsenal.Size.SMALL, true, r),
                            WIDE to build(context, WidgetArsenal.Size.WIDE, false, r),
                            BIG to build(context, WidgetArsenal.Size.BIG, false, r),
                            TALL to build(context, WidgetArsenal.Size.BIG, true, r),
                        ),
                    )
                } else {
                    val o = manager.getAppWidgetOptions(id)
                    val w = o?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) ?: 0
                    val h = o?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT) ?: 0
                    // 크기를 모르면(0) 처음 놓는 크기 4×2.
                    if (w <= 0 || h <= 0) {
                        build(context, WidgetArsenal.Size.BIG, false, r)
                    } else {
                        val size = WidgetArsenal.size(w, h)
                        build(context, size, WidgetArsenal.tall(size, h), r)
                    }
                }
                manager.updateAppWidget(id, views)
            }
        }

        private fun build(context: Context, size: WidgetArsenal.Size, tall: Boolean, r: WidgetArsenal.Rich): RemoteViews {
            val c = r.card
            val layout = when (size) {
                WidgetArsenal.Size.SMALL -> R.layout.arsenal_widget_small
                WidgetArsenal.Size.WIDE -> R.layout.arsenal_widget_wide
                WidgetArsenal.Size.BIG -> R.layout.arsenal_widget
            }
            val v = RemoteViews(context.packageName, layout)
            when (size) {
                WidgetArsenal.Size.SMALL -> {
                    v.setTextViewText(R.id.ars_circle, if (r.post) r.headCode ?: c.lastInitial else c.lastInitial)
                    v.setTextViewText(R.id.ars_top, r.smallTop)
                    v.setTextViewText(R.id.ars_bottom, r.smallBottom)
                    v.setViewVisibility(R.id.ars_formrow, if (tall) View.VISIBLE else View.GONE)
                    if (tall) form(v, c)
                }
                WidgetArsenal.Size.WIDE -> {
                    form(v, c)
                    v.setTextViewText(R.id.ars_top, r.wideTop)
                    v.setTextViewText(R.id.ars_bottom, r.wideBottom)
                }
                WidgetArsenal.Size.BIG -> {
                    v.setTextViewText(R.id.ars_circle, r.headCode ?: c.initial)
                    v.setTextViewText(R.id.ars_top, r.title)
                    v.setTextViewText(R.id.ars_sub, r.sub)
                    line(v, R.id.ars_tag, r.headTag)
                    line(v, R.id.ars_side, r.headSide)
                    line(v, R.id.ars_dday, r.badge)
                    v.setTextViewText(R.id.ars_bottom, r.line2)
                    line(v, R.id.ars_sleep, r.sleep)
                    form(v, c)
                    v.setTextViewText(R.id.ars_last, r.formLine)
                    // 리뷰 첫 문장은 높은 칸(4×3 가까이)에서만. 누르면 앱에서 그 경기 리뷰.
                    line(v, R.id.ars_review, if (tall) r.review else null)
                    val reviewOpen = HomeWidgets.openArsenalMatch(context, r.reviewId, 332)
                    v.setOnClickPendingIntent(R.id.ars_review, reviewOpen)
                    v.setOnClickPendingIntent(R.id.ars_last, reviewOpen)
                    v.setViewVisibility(R.id.ars_next, if (r.next3.isEmpty()) View.GONE else View.VISIBLE)
                    val cells = intArrayOf(R.id.ars_n0, R.id.ars_n1, R.id.ars_n2)
                    val tags = intArrayOf(R.id.ars_n0_tag, R.id.ars_n1_tag, R.id.ars_n2_tag)
                    val texts = intArrayOf(R.id.ars_n0_text, R.id.ars_n1_text, R.id.ars_n2_text)
                    v.setTextViewText(R.id.ars_next_label, if (r.post) "다음" else "이후")
                    for (i in cells.indices) {
                        val m = r.next3.getOrNull(i)
                        if (m == null) {
                            v.setViewVisibility(cells[i], View.GONE)
                        } else {
                            v.setViewVisibility(cells[i], View.VISIBLE)
                            v.setTextViewText(tags[i], m.tag)
                            v.setTextViewText(texts[i], "${m.whenText} ${m.side}${m.code}")
                            v.setContentDescription(cells[i], "${m.whenText} ${m.tag} ${if (m.side == "⌂") "홈" else "원정"} ${m.name}")
                        }
                    }
                    val d = c.draft
                    if (d == null) {
                        v.setViewVisibility(R.id.ars_cal, View.GONE)
                    } else {
                        v.setViewVisibility(R.id.ars_cal, View.VISIBLE)
                        v.setOnClickPendingIntent(R.id.ars_cal, PendingIntent.getActivity(context, 330, insert(d), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
                    }
                    val fotmob = Intent(Intent.ACTION_VIEW, Uri.parse(WidgetArsenal.FOTMOB_URL)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    v.setOnClickPendingIntent(R.id.ars_fotmob, PendingIntent.getActivity(context, 331, fotmob, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
                }
            }
            v.setOnClickPendingIntent(R.id.ars_root, HomeWidgets.openApp(context, "arsenal", 320))
            return v
        }

        private fun form(v: RemoteViews, c: WidgetArsenal.Card) {
            val cells = intArrayOf(R.id.ars_f0, R.id.ars_f1, R.id.ars_f2, R.id.ars_f3, R.id.ars_f4)
            cells.forEachIndexed { i, cell ->
                val o = c.form.getOrNull(i)
                if (o == null) {
                    v.setViewVisibility(cell, View.GONE)
                } else {
                    v.setViewVisibility(cell, View.VISIBLE)
                    v.setTextViewText(cell, o)
                    v.setInt(cell, "setBackgroundResource", formBg(o))
                }
            }
            line(v, R.id.ars_formnote, c.formNote)
        }

        private fun line(v: RemoteViews, id: Int, text: String?) {
            if (text == null) {
                v.setViewVisibility(id, View.GONE)
            } else {
                v.setViewVisibility(id, View.VISIBLE)
                v.setTextViewText(id, text)
            }
        }

        private fun formBg(o: String): Int = when (o) {
            "승" -> R.drawable.widget_form_win
            "패" -> R.drawable.widget_form_loss
            else -> R.drawable.widget_form_draw
        }

        /** [달력에 넣기]: 폰 달력 앱 '일정 추가' 화면을 미리 채워 연다. 명진이 [저장]을 눌러야 들어간다(서버 쓰기 없음). */
        private fun insert(d: WidgetArsenal.Draft): Intent {
            val intent = Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            for ((k, value) in WidgetArsenal.calendarExtras(d)) {
                when (value) {
                    is Long -> intent.putExtra(k, value)
                    else -> intent.putExtra(k, value.toString())
                }
            }
            return intent
        }
    }
}

/**
 * 아스날 위젯을 놓을 때(또는 꾹 눌러 다시 고를 때) 뜨는 작은 설정 창: '결과 보이기'·'결과 가리기' 둘 중 하나(결정 ④).
 * 홈 화면 앱이 열어야 해서 내보내지만, 하는 일은 이 앱 아스날 위젯 번호의 켬/끔 하나 저장뿐이다. 모르는 번호는 받지 않는다.
 */
class ArsenalWidgetConfigActivity : Activity() {
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        widgetId = intent?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        val mine = AppWidgetManager.getInstance(this).getAppWidgetIds(ComponentName(this, ArsenalWidget::class.java))
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID || widgetId !in mine) {
            finish()
            return
        }
        title = "아스날 위젯"
        val dp = resources.displayMetrics.density
        val list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((8 * dp).toInt(), (4 * dp).toInt(), (8 * dp).toInt(), (8 * dp).toInt())
        }
        val current = ArsenalWidget.hidden(this, widgetId)
        listOf(false to "결과 보이기", true to "결과 가리기(누르면 보기)").forEach { (hide, label) ->
            val row = TextView(this).apply {
                text = (if (hide == current) "✓ " else "") + label
                textSize = 15f
                minHeight = (44 * dp).toInt()
                gravity = Gravity.CENTER_VERTICAL
                setPadding((12 * dp).toInt(), 0, (12 * dp).toInt(), 0)
                isClickable = true
                isFocusable = true
                setBackgroundResource(android.R.drawable.list_selector_background)
                setOnClickListener { pick(hide) }
            }
            list.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        setContentView(list)
    }

    private fun pick(hide: Boolean) {
        ArsenalWidget.setHidden(this, widgetId, hide)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
    }
}
