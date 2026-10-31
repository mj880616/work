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
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** 앱 프로세스 안에 하나뿐인 위젯 세션(토큰은 메모리·Keystore 금고에만). */
object WidgetHub {
    @Volatile private var session: WidgetSession? = null

    fun session(context: Context): WidgetSession =
        session ?: synchronized(this) {
            session ?: WidgetSession(OkHttpWidgetHttp(), KeystoreVault(context.applicationContext)).also { session = it }
        }
}

/** 위젯 갱신 작업(설계 3절 5, 동시 갱신 막기). 같은 이름 작업은 KEEP, 토큰 갱신은 WidgetSession 잠금 하나. */
object WidgetJobs {
    private const val PERIODIC = "widget-periodic"
    private const val NOW = "widget-now"
    /** APP-위젯다시 전 이름(작업 클래스 TodayWidgetWorker). 새 판에서 한 번 지운다(지운 클래스를 부르는 작업이 남지 않게). */
    private val OLD = listOf("today-widget-periodic", "today-widget-now")

    private fun constraints() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun schedule(context: Context) {
        OLD.forEach { WorkManager.getInstance(context).cancelUniqueWork(it) }
        val req = PeriodicWorkRequest.Builder(WidgetWorker::class.java, 30, TimeUnit.MINUTES).setConstraints(constraints()).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    /** 마지막으로 갱신 작업이 돈 시각(이 프로세스 메모리에만). 앱을 열 때 너무 자주 받지 않게. */
    @Volatile var lastRunAt = 0L

    /**
     * 지금 한 번(FIX-위젯): 일반 작업은 폰이 미뤄 위젯이 1분 넘게 '불러오는 중'이었다. 안드로이드 12+는 급한 작업(expedited)으로 바로 돌리고,
     * 급한 작업 몫이 없으면 일반 작업으로 돈다(RUN_AS_NON_EXPEDITED_WORK_REQUEST). 같은 이름이 이미 기다리면 KEEP(배터리).
     * replace: 위젯 로그인·로그아웃 직후처럼 이미 도는 작업이 옛 로그인 상태로 그릴 수 있을 때만 새로 바꾼다.
     */
    fun refreshNow(context: Context, replace: Boolean = false) {
        val builder = OneTimeWorkRequest.Builder(WidgetWorker::class.java).setConstraints(constraints())
        if (WidgetRefresh.expedite(Build.VERSION.SDK_INT)) builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP, builder.build())
    }

    /** 앱을 열 때: 위젯이 있고 마지막 갱신에서 5분이 지났으면 한 번. */
    fun refreshOnOpen(context: Context) {
        if (!HomeWidgets.anyRefreshed(context)) return
        if (WidgetRefresh.dueOnOpen(System.currentTimeMillis(), lastRunAt)) refreshNow(context)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        WorkManager.getInstance(context).cancelUniqueWork(NOW)
    }
}

/**
 * '지금'·'이번 주'·아스날 위젯을 같은 갱신 작업 하나로(배터리). 위젯 세션 읽기(readList)도 한 번에 묶는다:
 * 지금 위젯이 있으면 오늘~내일 일정·할 일·처리 전 후보, 이번 주 위젯이 있으면 보이는 주 일정.
 * 아스날은 공개 정적 파일이라 로그인 없이, 6시간에 한 번만 받는다(그 사이에는 메모리의 마지막 자료로 다시 그림).
 */
class WidgetWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        val now = WidgetGuard.get { NowWidget.hasWidgets(ctx) } == true
        val week = WidgetGuard.get { WeekWidget.hasWidgets(ctx) } == true
        val arsenal = WidgetGuard.get { ArsenalWidget.hasWidgets(ctx) } == true
        if (!now && !week && !arsenal) {
            WidgetGuard.run { WidgetJobs.cancel(ctx) }
            return Result.success()
        }
        val at = System.currentTimeMillis()
        WidgetJobs.lastRunAt = at
        // FIX-위젯: 위젯마다 울타리를 따로 둔다. 한 위젯(또는 아스날 파일 받기)이 실패해도 나머지는 그린다.
        if (now || week) {
            if (!WidgetGuard.run { refreshSigned(ctx, now, week, at) }) {
                if (now) WidgetGuard.run { NowWidget.show(ctx, NowWidget.State.Failed) }
                if (week) WidgetGuard.run { WeekWidget.show(ctx, WeekWidget.State.Failed) }
            }
        }
        // 아스날(공개 정적 파일, 로그인 없음)은 로그인 위젯 다음에. 6시간 안에 받은 자료가 있으면 다시 그리기만.
        if (arsenal && !WidgetGuard.run { ArsenalWidget.refresh(ctx, WidgetHub.session(ctx), at) }) {
            WidgetGuard.run { ArsenalWidget.showFailed(ctx) }
        }
        return Result.success()
    }

    private fun refreshSigned(ctx: Context, now: Boolean, week: Boolean, at: Long) {
        val session = WidgetHub.session(ctx)
        if (!session.signedIn()) {
            HomeWidgets.showSignedOut(ctx)
            return
        }
        val plan = WidgetRefresh(now, week, at)
        val r = plan.result(session.readList(plan.urls))
        r.now?.let { p -> WidgetGuard.run { NowWidget.show(ctx, NowWidget.state(p)) } || WidgetGuard.run { NowWidget.show(ctx, NowWidget.State.Failed) } }
        r.week?.let { p -> WidgetGuard.run { WeekWidget.show(ctx, WeekWidget.state(p)) } || WidgetGuard.run { WeekWidget.show(ctx, WeekWidget.State.Failed) } }
    }
}

/** 위젯 세션을 쓰는 위젯들(지금·이번 주)을 함께 다루는 곳. 로그인·로그아웃 뒤 앱이 부른다. */
object HomeWidgets {
    /** 위젯 세션을 쓰는 위젯이 하나라도 있는지(로그인 줄·갱신 대상). */
    fun any(context: Context): Boolean = NowWidget.hasWidgets(context) || WeekWidget.hasWidgets(context)

    /** 갱신 작업이 필요한 위젯이 하나라도 있는지(아스날 포함). */
    fun anyRefreshed(context: Context): Boolean = any(context) || ArsenalWidget.hasWidgets(context)

    /** 위젯 로그인이 없을 때 두 위젯 모두 같은 한 줄. */
    const val SIGNED_OUT_LINE = "위젯 로그인 필요 · 누르면 로그인"

    fun showSignedOut(context: Context) {
        WidgetGuard.run { NowWidget.show(context, NowWidget.State.SignedOut) }
        WidgetGuard.run { WeekWidget.show(context, WeekWidget.State.SignedOut) }
    }

    fun signedInChanged(context: Context, signedIn: Boolean) {
        if (!any(context)) return
        if (signedIn) {
            WidgetGuard.run { NowWidget.show(context, NowWidget.State.Loading) }
            WidgetGuard.run { WeekWidget.show(context, WeekWidget.State.Loading) }
            WidgetJobs.schedule(context)
            // 위젯 로그인 직후: 이미 도는 작업이 있으면(옛 '로그인 필요' 상태로 읽는 중) 새로 바꿔 바로 다시 읽는다.
            WidgetJobs.refreshNow(context, replace = true)
        } else {
            // 아스날(로그인 없음)이 남아 있으면 작업은 그대로 둔다.
            if (!ArsenalWidget.hasWidgets(context)) WidgetJobs.cancel(context)
            showSignedOut(context)
        }
    }

    /** 위젯 [로그인] 줄(지금·이번 주 같은 길). */
    fun login(context: Context): PendingIntent {
        val intent = Intent(context, WidgetLoginActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(context, 21, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /** 앱의 그 화면(view 없으면 홈)을 연다. 요청 번호는 위젯마다 다르게. */
    fun openApp(context: Context, view: String?, code: Int): PendingIntent {
        val url = if (view == null) ShellRules.HOME else ShellRules.HOME + "?view=" + view
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url), context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /**
     * 크기별 그림(APP-위젯다시): 안드로이드 12(API 31)부터는 작은·큰 그림을 함께 주고 홈 화면이 칸 크기에 맞는 것을 고른다.
     * 그 아래는 큰 그림 하나. fill(views, small)이 두 그림을 같은 내용으로 채운다(없는 칸에 대한 설정은 홈 화면이 건너뜀).
     */
    fun sized(context: Context, small: Int, large: Int, smallSize: SizeF, largeSize: SizeF, fill: (RemoteViews, Boolean) -> Unit): RemoteViews {
        val big = RemoteViews(context.packageName, large).also { fill(it, false) }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return big
        val little = RemoteViews(context.packageName, small).also { fill(it, true) }
        return RemoteViews(mapOf(smallSize to little, largeSize to big))
    }
}

/**
 * 홈 화면 '웹2 지금' 위젯(4×2·2×2, APP-위젯다시 ①). 지난 '오늘'·'텔레그램' 위젯을 합쳐 바꿨다. 홈 화면 전용(결정 W-D4).
 * 4×2: 다음 일정을 크게(시각·제목·남은 시간) + 그다음 한 줄 + 처리할 것 세 줄(요청·챙길 것·오늘 기한 할 일).
 * 2×2: 다음 일정 + 요청·챙길 것 숫자 두 칸. 줄을 누르면 그 자리(달력·정리함·할 일).
 * 마지막에 그린 내용은 이 프로세스 메모리에만 둔다(폰에 저장하지 않음, 결정 W-D2).
 */
class NowWidget : AppWidgetProvider() {
    sealed class State {
        object Loading : State()
        object SignedOut : State()
        object Failed : State()
        data class Shown(val content: WidgetNow.Content) : State()
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val signedIn = WidgetGuard.get { WidgetHub.session(context).signedIn() } == true
        show(context, if (!signedIn) State.SignedOut else last?.let { State.Shown(it) } ?: State.Loading, manager, ids)
        if (signedIn) {
            WidgetJobs.schedule(context)
            WidgetJobs.refreshNow(context)
        }
    }

    override fun onEnabled(context: Context) {
        if (WidgetHub.session(context).signedIn()) WidgetJobs.schedule(context)
    }

    override fun onDisabled(context: Context) {
        if (!HomeWidgets.anyRefreshed(context)) WidgetJobs.cancel(context)
        last = null
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            if (WidgetHub.session(context).signedIn()) {
                show(context, last?.let { State.Shown(it) } ?: State.Loading)
                WidgetJobs.refreshNow(context)
            } else {
                show(context, State.SignedOut)
            }
            return
        }
        super.onReceive(context, intent)
    }

    companion object {
        const val ACTION_REFRESH = "kr.or.kptu.work.widget.REFRESH"
        private val SMALL = SizeF(110f, 110f)
        private val LARGE = SizeF(250f, 110f)
        private val ROWS = intArrayOf(R.id.now_row_asks, R.id.now_row_todo, R.id.now_row_due)

        @Volatile private var last: WidgetNow.Content? = null

        fun hasWidgets(context: Context): Boolean =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, NowWidget::class.java)).isNotEmpty()

        /** 로그인·로그아웃 뒤 앱이 부른다(이번 주 위젯도 함께). */
        fun signedInChanged(context: Context, signedIn: Boolean) {
            if (!signedIn) last = null
            HomeWidgets.signedInChanged(context, signedIn)
        }

        fun state(p: WidgetRefresh.Paint<WidgetNow.Content>): State = when (p) {
            is WidgetRefresh.Paint.Shown -> State.Shown(p.content)
            WidgetRefresh.Paint.SignedOut -> State.SignedOut
            WidgetRefresh.Paint.Failed -> State.Failed
        }

        fun show(context: Context, state: State) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, NowWidget::class.java))
            if (ids.isNotEmpty()) show(context, state, manager, ids)
        }

        /** 그리다 실패하면(예외·초기화 실패) 빈칸 대신 '불러오지 못했어요' 한 줄만 그린다(FIX-위젯). */
        private fun show(context: Context, state: State, manager: AppWidgetManager, ids: IntArray) {
            if (WidgetGuard.run { draw(context, state, manager, ids) }) return
            WidgetGuard.run {
                val views = RemoteViews(context.packageName, R.layout.now_widget)
                note(views, "불러오지 못했어요 · ↻로 다시")
                views.setOnClickPendingIntent(R.id.now_refresh, refresh(context))
                manager.updateAppWidget(ids, views)
            }
        }

        private fun draw(context: Context, state: State, manager: AppWidgetManager, ids: IntArray) {
            when (state) {
                is State.Shown -> last = state.content
                State.SignedOut -> last = null
                else -> Unit
            }
            val views = HomeWidgets.sized(context, R.layout.now_widget_small, R.layout.now_widget, SMALL, LARGE) { v, small -> paint(context, v, state, small) }
            manager.updateAppWidget(ids, views)
        }

        private fun paint(context: Context, views: RemoteViews, state: State, small: Boolean) {
            views.setOnClickPendingIntent(R.id.now_refresh, refresh(context))
            views.setOnClickPendingIntent(R.id.now_next, HomeWidgets.openApp(context, "calendar", 12))
            views.setViewVisibility(R.id.now_note, View.GONE)
            when (state) {
                State.SignedOut -> {
                    blank(views)
                    views.setViewVisibility(R.id.now_refresh, View.GONE)
                    note(views, HomeWidgets.SIGNED_OUT_LINE)
                    views.setOnClickPendingIntent(R.id.now_note, HomeWidgets.login(context))
                }
                State.Loading -> {
                    blank(views)
                    views.setViewVisibility(R.id.now_refresh, View.VISIBLE)
                    note(views, "불러오는 중")
                }
                State.Failed -> {
                    views.setViewVisibility(R.id.now_refresh, View.VISIBLE)
                    val shown = last
                    if (shown != null) content(context, views, shown, small) else blank(views)
                    note(views, "불러오지 못했어요 · ↻로 다시")
                }
                is State.Shown -> {
                    views.setViewVisibility(R.id.now_refresh, View.VISIBLE)
                    content(context, views, state.content, small)
                    state.content.note?.let { note(views, it) }
                }
            }
        }

        private fun blank(views: RemoteViews) {
            views.setTextViewText(R.id.now_left, "")
            views.setTextViewText(R.id.now_time, "")
            views.setTextViewText(R.id.now_title, "")
            views.setViewVisibility(R.id.now_after, View.GONE)
            ROWS.forEach { views.setViewVisibility(it, View.GONE) }
        }

        private fun content(context: Context, views: RemoteViews, c: WidgetNow.Content, small: Boolean) {
            val next = c.next
            if (next != null) {
                views.setTextViewText(R.id.now_left, next.left)
                views.setTextViewText(R.id.now_time, next.time)
                views.setViewVisibility(R.id.now_time, View.VISIBLE)
                views.setTextViewText(R.id.now_title, next.title)
            } else {
                views.setTextViewText(R.id.now_left, "")
                views.setTextViewText(R.id.now_time, "")
                views.setViewVisibility(R.id.now_time, View.GONE)
                views.setTextViewText(R.id.now_title, WidgetNow.NO_NEXT)
            }
            if (c.after != null) {
                views.setViewVisibility(R.id.now_after, View.VISIBLE)
                views.setTextViewText(R.id.now_after, c.after)
            } else {
                views.setViewVisibility(R.id.now_after, View.GONE)
            }
            line(context, views, R.id.now_row_asks, R.id.now_asks_n, R.id.now_asks_text, c.asks, R.drawable.widget_badge_req, R.color.widget_req_ink, small, "basket", 14)
            line(context, views, R.id.now_row_todo, R.id.now_todo_n, R.id.now_todo_text, c.todo, R.drawable.widget_badge_todo, R.color.widget_todo_ink, small, "basket", 15)
            line(context, views, R.id.now_row_due, R.id.now_due_n, R.id.now_due_text, c.due, R.drawable.widget_badge_todo, R.color.widget_todo_ink, small, "tasks", 13)
        }

        /** 처리할 것 한 줄. 0·읽지 못함은 옅은 회색 표, 1 이상은 그 줄 색. 2×2는 숫자 칸이라 표 바탕을 칠하지 않는다. */
        private fun line(context: Context, views: RemoteViews, row: Int, num: Int, text: Int, l: WidgetNow.Line, badge: Int, ink: Int, small: Boolean, view: String, code: Int) {
            views.setViewVisibility(row, View.VISIBLE)
            views.setTextViewText(num, l.count?.toString() ?: "–")
            views.setTextViewText(text, l.text)
            val on = (l.count ?: 0) > 0
            if (!small) {
                views.setInt(num, "setBackgroundResource", if (on) badge else R.drawable.widget_badge_zero)
                views.setTextColor(num, context.getColor(if (on) ink else R.color.widget_zero_ink))
            }
            views.setOnClickPendingIntent(row, HomeWidgets.openApp(context, view, code))
        }

        private fun note(views: RemoteViews, text: String) {
            views.setViewVisibility(R.id.now_note, View.VISIBLE)
            views.setTextViewText(R.id.now_note, text)
        }

        private fun refresh(context: Context): PendingIntent {
            val intent = Intent(context, NowWidget::class.java).setAction(ACTION_REFRESH)
            return PendingIntent.getBroadcast(context, 20, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
    }
}

/**
 * 위젯 [로그인] 줄이 여는 내보내지 않은(exported=false) 화면. 이 앱 안에서만 열 수 있다.
 * 메모리에 '위젯용 로그인' 표시(10분·한 번)를 세우고 웹2 화면을 위젯 로그인 동작으로 연다. 화면은 그리지 않고 바로 닫는다.
 */
class WidgetLoginActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WidgetHub.session(this).beginLogin()
        startActivity(Intent(this, MainActivity::class.java).setAction(WidgetRules.ACTION_WIDGET_LOGIN))
        finish()
    }
}
