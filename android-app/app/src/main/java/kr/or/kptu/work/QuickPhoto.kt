package kr.or.kptu.work

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.File

/**
 * APP-위젯빠른쓰기 남은 일 1: 위젯 [사진] 뒤에서 올리기(설계 docs/design/phone-widget-auth.md 13.7절). 규칙은 QuickPhotoRules(JVM 시험).
 * 1) PhotoPickActivity가 고른 사진을 앱 전용 임시 폴더로 복사(고른 사진의 임시 읽기 권한은 창이 살아 있을 때만 있으므로)하고 창을 닫는다.
 * 2) QuickPhotoWorker(WorkManager, 인터넷 연결 조건)가 위젯 세션으로 정리함 첨부 올리기(basket-files)를 부른다. 올린 장은 바로 지운다.
 * 3) 다 되면 짧은 알림(토스트). 일시 오류는 저절로 다시(최대 3번), 그래도 안 되면 토스트 한 줄 + 남은 사진은 임시 폴더에 두고
 *    다음에 위젯 [사진]을 누르면 이어 올린다(다시 시도). 3일 지난 묶음은 지운다.
 *    폰 알림줄 알림은 쓰지 않는다(알림 권한은 녹음 알림줄 전용, 명진 결정 MTG-폰녹음·collaboration-ownership-check).
 * 서버·DB·Edge 변경 없음. 파일 이름·토큰·응답은 로그에 남기지 않는다.
 */
object QuickPhoto {
    private const val DIR = "quick-photo"
    const val EXTRA_BATCH = "batch"

    /** 백업에서 빠지는 앱 전용 폴더(다른 앱이 못 읽음). 캐시가 아니어서 올리기 전에 폰이 지우지 않는다. */
    fun store(context: Context): QuickPhotoStore = QuickPhotoStore(File(context.noBackupFilesDir, DIR).apply { mkdirs() })

    data class Staged(val batch: String, val count: Int, val skipped: Int)

    /** 고른 사진을 임시 묶음으로 복사한다. 한 장도 못 넣으면 null(묶음을 지움). 창(UI 스레드) 밖에서 부른다. */
    fun stage(context: Context, resolver: ContentResolver, uris: List<Uri>): Staged? {
        val store = store(context)
        WidgetGuard.run { store.prune() }
        val batch = store.create()
        val kept = ArrayList<Triple<Int, String, String>>()
        var skipped = (uris.size - QuickPhotoRules.MAX_FILES).coerceAtLeast(0)
        try {
            uris.take(QuickPhotoRules.MAX_FILES).forEachIndexed { i, uri ->
                val meta = ShareIntake.meta(resolver, uri, "image/*", i)
                val ok = WidgetGuard.get { resolver.openInputStream(uri)?.use { store.add(batch, i, it) } } == true
                if (ok) kept.add(Triple(i, QuickPhotoRules.uploadType(meta.type), QuickPhotoRules.uploadName(meta.name, i))) else skipped++
            }
            if (kept.isEmpty()) {
                store.drop(batch)
                return null
            }
            store.seal(batch, kept)
        } catch (_: Exception) {
            store.drop(batch)
            return null
        }
        return Staged(batch, kept.size, skipped)
    }

    /** 뒤에서 올리기를 맡긴다(묶음마다 이름 하나, 이미 기다리면 그대로). */
    fun start(context: Context, batch: String) {
        require(QuickPhotoRules.isBatch(batch))
        val builder = OneTimeWorkRequest.Builder(QuickPhotoWorker::class.java)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(Data.Builder().putString(EXTRA_BATCH, batch).build())
        if (WidgetRefresh.expedite(Build.VERSION.SDK_INT)) builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        WorkManager.getInstance(context).enqueueUniqueWork("quick-photo-$batch", ExistingWorkPolicy.KEEP, builder.build())
    }

    fun toast(context: Context, text: String) {
        val app = context.applicationContext
        Handler(Looper.getMainLooper()).post { WidgetGuard.run { Toast.makeText(app, text, Toast.LENGTH_SHORT).show() } }
    }

    /** 실패 한 줄(토스트). 남은 사진은 임시 폴더에 두고, 다음에 위젯 [사진]을 누르면 이어 올린다(resume). */
    fun failed(context: Context, run: QuickPhotoRules.Run.Stopped) {
        toast(context, QuickPhotoRules.failed(run))
    }

    /** 위젯 로그인이 있는지(뒤에서 올릴 수 있는지). 위젯 칸 코드는 서버·세션을 직접 만지지 않고 여기를 거친다. */
    fun signedIn(context: Context): Boolean = WidgetHub.session(context.applicationContext).signedIn()

    /** 위젯 [사진]을 누를 때: 위젯 로그인이 있으면 남아 있는 묶음(실패·로그인 풀림으로 멈춘 것)을 다시 맡긴다. 이미 도는 묶음은 그대로(KEEP). */
    fun resume(context: Context): Int {
        if (!signedIn(context)) return 0
        val pending = store(context).pending()
        pending.forEach { WidgetGuard.run { start(context, it) } }
        return pending.size
    }
}

/** 묶음 하나를 올린다(QuickPhotoRules.run). 결과는 토스트 한 줄로만 알린다. */
class QuickPhotoWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        val batch = inputData.getString(QuickPhoto.EXTRA_BATCH)
        if (!QuickPhotoRules.isBatch(batch)) return Result.success()
        val store = QuickPhoto.store(ctx)
        if (!store.exists(batch!!)) return Result.success()
        val session = WidgetGuard.get { WidgetHub.session(ctx) }
        val run = if (session == null) {
            QuickPhotoRules.Run.Stopped(QuickPhotoRules.NETWORK, true, 0, store.total(batch))
        } else {
            WidgetGuard.get {
                QuickPhotoRules.run(store, batch) { item, note -> session.uploadPhoto(item.file, item.name, item.type, note) }
            } ?: QuickPhotoRules.Run.Stopped(QuickPhotoRules.NETWORK, true, 0, store.total(batch))
        }
        when (run) {
            is QuickPhotoRules.Run.Done -> QuickPhoto.toast(ctx, QuickPhotoRules.saved(run.saved))
            is QuickPhotoRules.Run.Stopped -> {
                // 인터넷·서버 일시 오류는 WorkManager가 조금 뒤 저절로 다시(최대 3번). 그래도 안 되면 한 줄 알리고 남은 사진은 둔다.
                if (QuickPhotoRules.autoRetry(run, runAttemptCount)) return Result.retry()
                QuickPhoto.failed(ctx, run)
            }
        }
        return Result.success()
    }
}
