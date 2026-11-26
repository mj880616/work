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
 * '이번 주' 위젯을 갱신하는 작업 하나(배터리). 위젯 세션 읽기(readList)도 한 번에 묶는다: 보이는 주 일정·할 일·서버 기능 목록.
 * S68-13(11/22 사용자): '지금'·'아스날' 위젯은 지웠다. 빠른 쓰기·한 칸 위젯은 서버를 읽지 않아 이 작업과 상관없다.
 */
class WidgetWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        val week = WidgetGuard.get { WeekWidget.hasWidgets(ctx) } == true
        if (!week) {
            WidgetGuard.run { WidgetJobs.cancel(ctx) }
            return Result.success()
        }
        val at = System.currentTimeMillis()
        WidgetJobs.lastRunAt = at
        // FIX-위젯: 울타리 안에서. 실패하면 '불러오지 못했어요' 한 줄.
        if (!WidgetGuard.run { refreshSigned(ctx, at) }) {
            WidgetGuard.run { WeekWidget.show(ctx, WeekWidget.State.Failed) }
        }
        return Result.success()
    }

    private fun refreshSigned(ctx: Context, at: Long) {
        val session = WidgetHub.session(ctx)
        if (!session.signedIn()) {
            HomeWidgets.showSignedOut(ctx)
            return
        }
        // S68-12: 이번 주 위젯이 옮겨 둔 주도 같은 일정 주소(범위만 다름)로 함께 읽는다.
        val plan = WidgetRefresh(at, WidgetGuard.get { WeekWidget.shifts(at) } ?: setOf(0))
        val r = plan.result(session.readList(plan.urls))
        WidgetGuard.run { AppFolders.rememberNojoWords(ctx, r.nojoWords) }
        if (!WidgetGuard.run { WeekWidget.show(ctx, WeekWidget.state(r.weeks, at)) }) WidgetGuard.run { WeekWidget.show(ctx, WeekWidget.State.Failed) }
        // S68-12: 읽는 동안 위젯에서 다른 주로 옮겼으면(이 작업이 도는 중이라 새 작업이 끼지 못함) 한 번 더 읽는다.
        val more = WidgetGuard.get { WeekWidget.shifts() }.orEmpty() - plan.shifts.toSet()
        if (more.isNotEmpty()) {
            val again = WidgetRefresh(System.currentTimeMillis(), WeekWidget.shifts())
            val r2 = again.result(session.readList(again.urls))
            if (!WidgetGuard.run { WeekWidget.show(ctx, WeekWidget.state(r2.weeks, again.nowMs)) }) WidgetGuard.run { WeekWidget.show(ctx, WeekWidget.State.Failed) }
        }
    }
}

/**
 * 홈 화면 위젯을 함께 다루는 곳. 로그인·로그아웃 뒤 앱이 부른다. 위젯 세션을 쓰는 위젯은 '이번 주' 하나.
 * S68-13(11/22 사용자): '지금'·'아스날' 위젯을 지우면서 '지금' 위젯 파일에서 이 파일로 그대로 옮겼다.
 */
object HomeWidgets {
    /** 위젯 세션을 쓰는 위젯이 하나라도 있는지(로그인 줄·갱신 대상). */
    fun any(context: Context): Boolean = WeekWidget.hasWidgets(context)

    /** 갱신 작업이 필요한 위젯이 하나라도 있는지(지금은 위젯 세션을 쓰는 위젯과 같다). */
    fun anyRefreshed(context: Context): Boolean = any(context)

    /** 홈 화면 위젯 전부(3종). 새 판 설치 뒤 다시 그릴 때 쓴다. */
    val PROVIDERS: List<Class<out AppWidgetProvider>> = listOf(
        QuickWidget::class.java, OneWidget::class.java, WeekWidget::class.java,
    )

    /**
     * APP-죽은위젯: 새 판으로 바뀐 뒤(MY_PACKAGE_REPLACED) 홈에 놓인 위젯마다 onUpdate를 다시 불러 새 화면 틀로 그린다.
     * 옛 판에서 그리기에 실패해 '위젯을 추가할 수 없습니다'로 남은 자리도 지우지 않고 살아나게 한다.
     */
    fun repaintAll(context: Context) {
        val app = context.applicationContext
        val manager = AppWidgetManager.getInstance(app)
        for (provider in PROVIDERS) {
            WidgetGuard.run {
                val ids = manager.getAppWidgetIds(ComponentName(app, provider))
                if (ids.isNotEmpty()) {
                    app.sendBroadcast(
                        Intent(app, provider)
                            .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
                            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids),
                    )
                }
            }
        }
    }

    /** 위젯 로그인이 없을 때의 한 줄. */
    const val SIGNED_OUT_LINE = "위젯 로그인 필요 · 누르면 로그인"

    fun showSignedOut(context: Context) {
        WidgetGuard.run { WeekWidget.show(context, WeekWidget.State.SignedOut) }
    }

    fun signedInChanged(context: Context, signedIn: Boolean) {
        if (!any(context)) return
        if (signedIn) {
            WidgetGuard.run { WeekWidget.show(context, WeekWidget.State.Loading) }
            WidgetJobs.schedule(context)
            // 위젯 로그인 직후: 이미 도는 작업이 있으면(옛 '로그인 필요' 상태로 읽는 중) 새로 바꿔 바로 다시 읽는다.
            WidgetJobs.refreshNow(context, replace = true)
        } else {
            WidgetJobs.cancel(context)
            showSignedOut(context)
        }
    }

    /** 위젯 [로그인] 줄. */
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

    /**
     * S68-08: 홈 화면이 이 위젯에 실제로 준 크기(dp) 목록. 안드로이드 12+는 OPTION_APPWIDGET_SIZES(기종·접음·펼침마다),
     * 없으면 세로(최소 폭·최대 높이)·가로(최대 폭·최소 높이) 두 가지. 아직 모르면 빈 목록.
     */
    fun cellSizes(manager: AppWidgetManager, id: Int): List<SizeF> {
        val options = manager.getAppWidgetOptions(id) ?: return emptyList()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            @Suppress("DEPRECATION")
            val sizes = options.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
            val ok = sizes?.filter { it.width > 0f && it.height > 0f }?.distinct()
            if (!ok.isNullOrEmpty()) return ok.take(16)
        }
        val minW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
        val maxW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH)
        val minH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT)
        val maxH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)
        return listOf(SizeF(minW.toFloat(), maxH.toFloat()), SizeF(maxW.toFloat(), minH.toFloat()))
            .filter { it.width > 0f && it.height > 0f }
            .distinct()
    }

    /**
     * S68-08: 크기마다 그린 그림. 안드로이드 12+는 크기별 그림을 모두 주고 홈 화면이 지금 크기에 맞는 것을 고른다(sized와 같은 방식).
     * 11 이하는 세로 크기 하나로 그린다. 크기를 모르면 build(null).
     */
    fun perSize(sizes: List<SizeF>, build: (SizeF?) -> RemoteViews): RemoteViews {
        if (sizes.isEmpty()) return build(null)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || sizes.size == 1) return build(sizes.first())
        return RemoteViews(sizes.associateWith { build(it) })
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
