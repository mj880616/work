package kr.or.kptu.work

import android.content.Context
import android.os.Build
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
 * APP-뒤에서올리기 1단계(설계 docs/design/phone-widget-auth.md 16절): 웹 화면이 넘긴 사진·파일을 뒤에서 올린다. 규칙은 BackUploadRules(JVM 시험).
 * 1) MainActivity의 up: 다리가 조각을 앱 전용·백업 제외 폴더(noBackupFilesDir/back-upload/<묶음>)에 쓴다(BackUploadStore).
 * 2) up:go에서 묶음을 닫고 BackUploadWorker(WorkManager, 인터넷 연결 조건)를 건다. 화면이 살아 있을 필요가 없다.
 * 3) Worker가 위젯 세션으로 지금 서버 입구(library-files)에 한 개씩 올린다. 끝낸 파일은 바로 지우고 결과를 묶음에 적는다.
 * 4) 묶음이 바뀔 때마다 화면이 살아 있으면 알린다(listener → up:job). 다 되면 토스트 한 줄.
 *    일시 오류는 저절로 다시(최대 3번), 그래도 안 되면 한 줄 알리고 남은 파일은 두었다가 앱 화면이 열리면(up:hello) 다시 건다.
 * 위젯 [사진](QuickPhoto)과 폴더·작업 이름·서버 입구가 다르고, 폰 녹음(RecordHub, rec/)과도 겹치지 않는다.
 * 서버·DB·Edge 변경 없음. 새 안드로이드 권한·내보내는 부품 없음. 파일 이름·토큰·응답은 로그에 남기지 않는다.
 */
object BackUpload {
    private const val DIR = "back-upload"
    const val EXTRA_BATCH = "batch"
    /** 받기 전에 남겨 둘 폰 빈 공간(이보다 모자라면 넘겨받지 않고 웹이 지금 길로 올린다). */
    private const val SPACE_MARGIN = 64L * 1024 * 1024

    /** 화면(MainActivity)이 살아 있을 때 묶음이 바뀌었음을 받는 곳. 묶음 이름만 넘긴다. */
    @Volatile
    var listener: ((String) -> Unit)? = null

    /** 백업에서 빠지는 앱 전용 폴더(다른 앱이 못 읽음). 캐시가 아니어서 올리기 전에 폰이 지우지 않는다. */
    fun store(context: Context): BackUploadStore = BackUploadStore(File(context.noBackupFilesDir, DIR).apply { mkdirs() })

    /** 위젯 로그인이 있는지(뒤에서 올릴 수 있는지). 서버·세션을 직접 만지지 않고 여기를 거친다. */
    fun signedIn(context: Context): Boolean = WidgetGuard.get { WidgetHub.session(context.applicationContext).signedIn() } == true

    /** 이 크기를 받을 빈 공간이 있는지. */
    fun roomFor(context: Context, size: Long): Boolean =
        WidgetGuard.get { context.noBackupFilesDir.usableSpace > size + SPACE_MARGIN } == true

    /** 뒤에서 올리기를 맡긴다(묶음마다 이름 하나, 이미 기다리면 그대로). */
    fun start(context: Context, batch: String) {
        require(QuickPhotoRules.isBatch(batch))
        val builder = OneTimeWorkRequest.Builder(BackUploadWorker::class.java)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(Data.Builder().putString(EXTRA_BATCH, batch).build())
        if (WidgetRefresh.expedite(Build.VERSION.SDK_INT)) builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork("back-upload-$batch", ExistingWorkPolicy.KEEP, builder.build())
    }

    /**
     * 앱 화면이 열릴 때(up:hello): 위젯 로그인이 있으면 멈춰 있던 묶음을 다시 건다. 이미 도는 묶음은 그대로(KEEP).
     * 다시 건 묶음은 멈춘 까닭을 지워 '올리는 중'으로 보인다.
     */
    fun resume(context: Context): Int {
        if (!signedIn(context)) return 0
        val store = store(context)
        val pending = store.pending()
        pending.forEach { batch ->
            WidgetGuard.run {
                store.stop(batch, null)
                start(context, batch)
            }
        }
        return pending.size
    }

    fun changed(batch: String) {
        val l = listener ?: return
        WidgetGuard.run { l(batch) }
    }
}

/** 묶음 하나를 올린다(BackUploadRules.run). 결과는 토스트 한 줄과 화면 알림(up:job)으로만 알린다. */
class BackUploadWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        val batch = inputData.getString(BackUpload.EXTRA_BATCH)
        if (!QuickPhotoRules.isBatch(batch)) return Result.success()
        val store = BackUpload.store(ctx)
        if (!store.exists(batch!!) || store.total(batch) <= 0) return Result.success()
        val left = store.items(batch).size
        val total = store.total(batch)
        // 이미 끝난 묶음(같은 작업이 한 번 더 돈 경우)은 다시 알리지 않는다.
        if (left <= 0) return Result.success()
        val failed = { reason: String -> BackUploadRules.Run.Stopped(reason, true, left, total) }
        // 다시 도는 묶음은 '멈춤' 표시를 지운다(화면에는 '올리는 중').
        WidgetGuard.run { store.stop(batch, null) }
        val session = WidgetGuard.get { WidgetHub.session(ctx) }
        val run = if (session == null) failed(BackUploadRules.INTERNAL) else {
            WidgetGuard.get {
                BackUploadRules.run(store, batch, after = { BackUpload.changed(batch) }) { item, target ->
                    // 시스템이 이 작업을 멈췄으면(시간 한도 등) 새 파일을 시작하지 않는다. WorkManager가 다시 걸면 남은 것부터 잇는다.
                    if (isStopped) BackUploadRules.One.Failed(BackUploadRules.INTERNAL, true)
                    else session.uploadLibrary(item.file, item.name, item.type, target, item.fields)
                }
            } ?: failed(BackUploadRules.INTERNAL)
        }
        when (run) {
            is BackUploadRules.Run.Done -> if (run.total > 0) QuickPhoto.toast(ctx, BackUploadRules.doneText(run))
            is BackUploadRules.Run.Stopped -> {
                // 시스템이 멈춘 작업은 알리지 않는다(WorkManager가 스스로 다시 건다).
                if (isStopped) return Result.retry()
                // 인터넷·서버 일시 오류는 WorkManager가 조금 뒤 저절로 다시(최대 3번). 그래도 안 되면 한 줄 알리고 남은 파일은 둔다.
                if (BackUploadRules.autoRetry(run, runAttemptCount)) return Result.retry()
                WidgetGuard.run { store.stop(batch, run.reason) }
                QuickPhoto.toast(ctx, BackUploadRules.stoppedText(run))
            }
        }
        BackUpload.changed(batch)
        return Result.success()
    }
}
