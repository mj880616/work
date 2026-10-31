package kr.or.kptu.work

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
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
 * 3) 다 되면 짧은 알림(토스트), 실패하면 알림 한 줄 + [다시 시도]. 알림을 밀어 버리면 남은 임시 파일을 지운다.
 * 서버·DB·Edge 변경 없음. 파일 이름·토큰·응답은 로그에 남기지 않는다.
 */
object QuickPhoto {
    private const val DIR = "quick-photo"
    private const val CHANNEL = "quick-photo"
    const val EXTRA_BATCH = "batch"
    const val ACTION_RETRY = "kr.or.kptu.work.action.QUICK_PHOTO_RETRY"
    const val ACTION_DISCARD = "kr.or.kptu.work.action.QUICK_PHOTO_DISCARD"

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

    private fun id(batch: String): Int = 7000 + (batch.hashCode() and 0x0fff)

    fun clearNotice(context: Context, batch: String) {
        WidgetGuard.run { NotificationManagerCompat.from(context).cancel(id(batch)) }
    }

    /** 실패 알림 한 줄. 다시 될 실패면 [다시 시도], 알림을 밀어 버리면 임시 파일을 지운다. 알림이 꺼져 있어도 토스트로 한 번 알린다. */
    fun failed(context: Context, batch: String, run: QuickPhotoRules.Run.Stopped) {
        val text = QuickPhotoRules.failed(run)
        toast(context, text)
        // 알림 권한(안드로이드 13+)이 없으면 토스트만. 녹음 때 한 번 묻는 권한과 같다(새로 묻지 않음).
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        WidgetGuard.run {
            val nm = context.getSystemService(NotificationManager::class.java)
            if (nm?.getNotificationChannel(CHANNEL) == null) {
                nm?.createNotificationChannel(NotificationChannel(CHANNEL, "사진 올리기", NotificationManager.IMPORTANCE_DEFAULT))
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            val b = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_w_photo)
                .setContentTitle("웹2 사진")
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
            if (run.retry) {
                b.addAction(0, "다시 시도", PendingIntent.getBroadcast(context, id(batch), action(context, ACTION_RETRY, batch), flags))
                b.setDeleteIntent(PendingIntent.getBroadcast(context, id(batch) + 0x1000, action(context, ACTION_DISCARD, batch), flags))
            }
            NotificationManagerCompat.from(context).notify(id(batch), b.build())
        }
    }

    private fun action(context: Context, action: String, batch: String): Intent =
        Intent(context, QuickPhotoReceiver::class.java).setAction(action).putExtra(EXTRA_BATCH, batch)
}

/** 묶음 하나를 올린다(QuickPhotoRules.run). 결과는 토스트·알림으로만 알린다. */
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
            is QuickPhotoRules.Run.Done -> {
                QuickPhoto.clearNotice(ctx, batch)
                QuickPhoto.toast(ctx, QuickPhotoRules.saved(run.saved))
            }
            is QuickPhotoRules.Run.Stopped -> QuickPhoto.failed(ctx, batch, run)
        }
        return Result.success()
    }
}

/** 실패 알림의 [다시 시도]·밀어 버리기. 내보내지 않아 이 앱 알림만 보낸다. 모르는 묶음 번호는 무시한다. */
class QuickPhotoReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val batch = intent.getStringExtra(QuickPhoto.EXTRA_BATCH)
        if (!QuickPhotoRules.isBatch(batch)) return
        val ctx = context.applicationContext
        WidgetGuard.run {
            val store = QuickPhoto.store(ctx)
            when (intent.action) {
                QuickPhoto.ACTION_RETRY -> {
                    QuickPhoto.clearNotice(ctx, batch!!)
                    if (store.exists(batch)) {
                        QuickPhoto.start(ctx, batch)
                        QuickPhoto.toast(ctx, "정리함에 다시 올리는 중이에요")
                    }
                }
                QuickPhoto.ACTION_DISCARD -> store.drop(batch!!)
            }
        }
    }
}
