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
    private const val PERIODIC = "today-widget-periodic"
    private const val NOW = "today-widget-now"

    private fun constraints() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun schedule(context: Context) {
        val req = PeriodicWorkRequest.Builder(TodayWidgetWorker::class.java, 30, TimeUnit.MINUTES).setConstraints(constraints()).build()
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
        val builder = OneTimeWorkRequest.Builder(TodayWidgetWorker::class.java).setConstraints(constraints())
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
 * 오늘·이번 주·텔레그램·아스날 위젯을 같은 갱신 작업 하나로(WIDGET-여러개 ②·③, 배터리). 위젯 세션 읽기(readList)도 한 번에 묶는다:
 * 오늘 위젯이 있으면 오늘 일정·할 일·처리 전 후보, 이번 주 위젯이 있으면 이번 주 일정, 텔레그램 위젯이 있으면 내 기능 목록·오늘 건수·최근 소식(+ 후보).
 * 아스날은 공개 정적 파일이라 로그인 없이, 6시간에 한 번만 받는다(그 사이에는 메모리의 마지막 자료로 다시 그림).
 */
class TodayWidgetWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        val today = WidgetGuard.get { TodayWidget.hasWidgets(ctx) } == true
        val week = WidgetGuard.get { WeekWidget.hasWidgets(ctx) } == true
        val tg = WidgetGuard.get { TelegramWidget.hasWidgets(ctx) } == true
        val arsenal = WidgetGuard.get { ArsenalWidget.hasWidgets(ctx) } == true
        if (!today && !week && !tg && !arsenal) {
            WidgetGuard.run { WidgetJobs.cancel(ctx) }
            return Result.success()
        }
        val now = System.currentTimeMillis()
        WidgetJobs.lastRunAt = now
        // FIX-위젯: 위젯마다 울타리를 따로 둔다. 한 위젯(또는 아스날 파일 받기)이 실패해도 나머지는 그린다.
        if (today || week || tg) {
            if (!WidgetGuard.run { refreshSigned(ctx, today, week, tg, now) }) {
                if (today) WidgetGuard.run { TodayWidget.show(ctx, TodayWidget.State.Failed) }
                if (week) WidgetGuard.run { WeekWidget.show(ctx, WeekWidget.State.Failed) }
                if (tg) WidgetGuard.run { TelegramWidget.show(ctx, TelegramWidget.State.Failed) }
            }
        }
        // 아스날(공개 정적 파일, 로그인 없음)은 로그인 위젯 다음에. 6시간 안에 받은 자료가 있으면 다시 그리기만.
        if (arsenal && !WidgetGuard.run { ArsenalWidget.refresh(ctx, WidgetHub.session(ctx), now) }) {
            WidgetGuard.run { ArsenalWidget.showFailed(ctx) }
        }
        return Result.success()
    }

    private fun refreshSigned(ctx: Context, today: Boolean, week: Boolean, tg: Boolean, now: Long) {
        val session = WidgetHub.session(ctx)
        if (!session.signedIn()) {
            HomeWidgets.showSignedOut(ctx)
            return
        }
        val plan = WidgetRefresh(today, week, tg, now)
        val r = plan.result(session.readList(plan.urls))
        r.today?.let { p -> WidgetGuard.run { TodayWidget.show(ctx, TodayWidget.state(p)) } || WidgetGuard.run { TodayWidget.show(ctx, TodayWidget.State.Failed) } }
        r.week?.let { p -> WidgetGuard.run { WeekWidget.show(ctx, WeekWidget.state(p)) } || WidgetGuard.run { WeekWidget.show(ctx, WeekWidget.State.Failed) } }
        r.tg?.let { p -> WidgetGuard.run { TelegramWidget.show(ctx, TelegramWidget.state(p)) } || WidgetGuard.run { TelegramWidget.show(ctx, TelegramWidget.State.Failed) } }
    }
}

/** 위젯 세션을 쓰는 위젯들(오늘·이번 주)을 함께 다루는 곳. 로그인·로그아웃 뒤 앱이 부른다. */
object HomeWidgets {
    /** 위젯 세션을 쓰는 위젯이 하나라도 있는지(로그인 줄·갱신 대상). */
    fun any(context: Context): Boolean = TodayWidget.hasWidgets(context) || WeekWidget.hasWidgets(context) || TelegramWidget.hasWidgets(context)

    /** 갱신 작업이 필요한 위젯이 하나라도 있는지(아스날 포함). */
    fun anyRefreshed(context: Context): Boolean = any(context) || ArsenalWidget.hasWidgets(context)

    /** 위젯 로그인이 없을 때 세 위젯 모두 같은 한 줄. */
    const val SIGNED_OUT_LINE = "위젯 로그인 필요 · 누르면 로그인"

    fun showSignedOut(context: Context) {
        WidgetGuard.run { TodayWidget.show(context, TodayWidget.State.SignedOut) }
        WidgetGuard.run { WeekWidget.show(context, WeekWidget.State.SignedOut) }
        WidgetGuard.run { TelegramWidget.show(context, TelegramWidget.State.SignedOut) }
    }

    fun signedInChanged(context: Context, signedIn: Boolean) {
        if (!any(context)) return
        if (signedIn) {
            WidgetGuard.run { TodayWidget.show(context, TodayWidget.State.Loading) }
            WidgetGuard.run { WeekWidget.show(context, WeekWidget.State.Loading) }
            WidgetGuard.run { TelegramWidget.show(context, TelegramWidget.State.Loading) }
            WidgetJobs.schedule(context)
            // 위젯 로그인 직후: 이미 도는 작업이 있으면(옛 '로그인 필요' 상태로 읽는 중) 새로 바꿔 바로 다시 읽는다.
            WidgetJobs.refreshNow(context, replace = true)
        } else {
            // 아스날(로그인 없음)이 남아 있으면 작업은 그대로 둔다.
            if (!ArsenalWidget.hasWidgets(context)) WidgetJobs.cancel(context)
            showSignedOut(context)
        }
    }

    /** 위젯 [로그인] 줄(오늘·이번 주 같은 길). */
    fun login(context: Context): PendingIntent {
        val intent = Intent(context, WidgetLoginActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(context, 21, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}

/**
 * 홈 화면 '웹2 오늘' 위젯(설계 6절, D7). 홈 화면 전용, 잠금 화면에는 놓지 않는다(결정 W-D4).
 * 읽기 두 가지(오늘 일정·할 일)만 위젯 세션으로 한다. [바구니]·줄 누르기는 앱을 열 뿐 서버 요청이 없다.
 * 마지막에 그린 내용은 이 프로세스 메모리에만 둔다(폰에 저장하지 않음, 결정 W-D2).
 */
class TodayWidget : AppWidgetProvider() {
    sealed class State {
        object Loading : State()
        object SignedOut : State()
        object Failed : State()
        data class Shown(val content: WidgetToday.Content) : State()
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
        private val ROWS = intArrayOf(R.id.widget_row0, R.id.widget_row1, R.id.widget_row2, R.id.widget_row3, R.id.widget_row4, R.id.widget_row5, R.id.widget_row6, R.id.widget_row7)

        @Volatile private var last: WidgetToday.Content? = null

        fun hasWidgets(context: Context): Boolean =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, TodayWidget::class.java)).isNotEmpty()

        /** 로그인·로그아웃 뒤 앱이 부른다(이번 주 위젯도 함께). */
        fun signedInChanged(context: Context, signedIn: Boolean) {
            if (!signedIn) last = null
            HomeWidgets.signedInChanged(context, signedIn)
        }

        fun state(p: WidgetRefresh.Paint<WidgetToday.Content>): State = when (p) {
            is WidgetRefresh.Paint.Shown -> State.Shown(p.content)
            WidgetRefresh.Paint.SignedOut -> State.SignedOut
            WidgetRefresh.Paint.Failed -> State.Failed
        }

        fun show(context: Context, state: State) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TodayWidget::class.java))
            if (ids.isNotEmpty()) show(context, state, manager, ids)
        }

        /** 그리다 실패하면(예외·초기화 실패) 빈칸 대신 '불러오지 못했어요' 한 줄만 그린다(FIX-위젯). */
        private fun show(context: Context, state: State, manager: AppWidgetManager, ids: IntArray) {
            if (WidgetGuard.run { paint(context, state, manager, ids) }) return
            WidgetGuard.run {
                val views = RemoteViews(context.packageName, R.layout.today_widget)
                views.setTextViewText(R.id.widget_title, "오늘")
                note(views, "불러오지 못했어요 · ↻로 다시")
                views.setOnClickPendingIntent(R.id.widget_refresh, refresh(context))
                manager.updateAppWidget(ids, views)
            }
        }

        private fun paint(context: Context, state: State, manager: AppWidgetManager, ids: IntArray) {
            when (state) {
                is State.Shown -> last = state.content
                State.SignedOut -> last = null
                else -> Unit
            }
            val views = RemoteViews(context.packageName, R.layout.today_widget)
            val now = System.currentTimeMillis()
            views.setOnClickPendingIntent(R.id.widget_title, openApp(context, null, 10))
            views.setOnClickPendingIntent(R.id.widget_basket, openApp(context, "basket", 11))
            views.setOnClickPendingIntent(R.id.widget_refresh, refresh(context))
            ROWS.forEach { views.setViewVisibility(it, View.GONE) }
            views.setViewVisibility(R.id.widget_note, View.GONE)
            views.setViewVisibility(R.id.widget_counts, View.GONE)
            when (state) {
                State.SignedOut -> {
                    views.setTextViewText(R.id.widget_title, WidgetToday.header(now))
                    views.setViewVisibility(R.id.widget_refresh, View.GONE)
                    views.setViewVisibility(ROWS[0], View.VISIBLE)
                    views.setTextViewText(ROWS[0], HomeWidgets.SIGNED_OUT_LINE)
                    views.setOnClickPendingIntent(ROWS[0], HomeWidgets.login(context))
                }
                State.Loading -> {
                    views.setTextViewText(R.id.widget_title, WidgetToday.header(now))
                    views.setViewVisibility(R.id.widget_refresh, View.VISIBLE)
                    note(views, "불러오는 중")
                }
                State.Failed -> {
                    val shown = last
                    views.setViewVisibility(R.id.widget_refresh, View.VISIBLE)
                    if (shown != null) {
                        rows(context, views, shown)
                        counts(context, views, shown)
                    } else {
                        views.setTextViewText(R.id.widget_title, WidgetToday.header(now))
                    }
                    note(views, "불러오지 못했어요 · ↻로 다시")
                }
                is State.Shown -> {
                    views.setViewVisibility(R.id.widget_refresh, View.VISIBLE)
                    rows(context, views, state.content)
                    counts(context, views, state.content)
                    state.content.note?.let { note(views, it) }
                }
            }
            manager.updateAppWidget(ids, views)
        }

        private fun note(views: RemoteViews, text: String) {
            views.setViewVisibility(R.id.widget_note, View.VISIBLE)
            views.setTextViewText(R.id.widget_note, text)
        }

        /** 맨 아래 '챙길 것 n · 나한테 온 요청 n'(건수만). 누르면 정리함. */
        private fun counts(context: Context, views: RemoteViews, content: WidgetToday.Content) {
            val line = content.counts ?: return
            views.setViewVisibility(R.id.widget_counts, View.VISIBLE)
            views.setTextViewText(R.id.widget_counts, line)
            views.setOnClickPendingIntent(R.id.widget_counts, openApp(context, "basket", 14))
        }

        private fun rows(context: Context, views: RemoteViews, content: WidgetToday.Content) {
            views.setTextViewText(R.id.widget_title, content.title)
            content.rows.take(ROWS.size).forEachIndexed { i, row ->
                val id = ROWS[i]
                views.setViewVisibility(id, View.VISIBLE)
                views.setTextViewText(id, if (row.time.isEmpty()) row.title else row.time + "  " + row.title)
                val view = if (row.target == WidgetToday.Target.CALENDAR) "calendar" else "tasks"
                views.setOnClickPendingIntent(id, openApp(context, view, if (view == "calendar") 12 else 13))
            }
        }

        private fun openApp(context: Context, view: String?, code: Int): PendingIntent {
            val url = if (view == null) ShellRules.HOME else ShellRules.HOME + "?view=" + view
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url), context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        private fun refresh(context: Context): PendingIntent {
            val intent = Intent(context, TodayWidget::class.java).setAction(ACTION_REFRESH)
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
