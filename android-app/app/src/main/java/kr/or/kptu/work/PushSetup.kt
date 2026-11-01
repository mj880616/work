package kr.or.kptu.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

/**
 * APP-폰알림 N4(설계 docs/design/phone-notifications.md 4.3·4.4·5절): 알림 준비.
 * - Firebase는 빌드 변수(BuildConfig.FCM_*)로만 직접 켠다. google-services.json·구글 서비스 Gradle 플러그인은 쓰지 않는다.
 *   변수가 비어 있으면(PR CI debug 빌드 등) 알림 기능은 꺼진 채로 돈다.
 * - 알림 권한(안드로이드 13+)은 웹2 내 프로필 '폰 알림'의 [이 폰에서 받기]·[시험 알림]에서 한 번 묻는다(MainActivity가 물음).
 * - 종류마다 알림 채널 하나(갤럭시 설정에서도 끌 수 있음). 켜기/끄기의 원본은 서버 설정(app_profiles.notify_prefs)이다.
 * - 잠금 화면에는 "웹2 · 새 알림"만(내용 숨김, N-D4).
 * 이 파일에는 토큰을 두지 않는다. '이 폰에서 받기' 표시(켬/끔)만 앱 설정에 둔다(비밀 아님).
 */
object PushSetup {
    const val PERMISSION = Manifest.permission.POST_NOTIFICATIONS
    private const val PREFS = "phone_push"
    private const val KEY_ON = "on"

    fun configured(): Boolean =
        PushRules.configOk(BuildConfig.FCM_PROJECT_ID, BuildConfig.FCM_APP_ID, BuildConfig.FCM_SENDER_ID, BuildConfig.FCM_API_KEY)

    /** 설정이 있으면 Firebase를 한 번 켠다. 켰거나 이미 켜져 있으면 true. */
    @Synchronized
    fun init(context: Context): Boolean {
        if (!configured()) return false
        val app = context.applicationContext
        return try {
            if (FirebaseApp.getApps(app).isEmpty()) {
                val options = FirebaseOptions.Builder()
                    .setProjectId(BuildConfig.FCM_PROJECT_ID)
                    .setApplicationId(BuildConfig.FCM_APP_ID)
                    .setGcmSenderId(BuildConfig.FCM_SENDER_ID)
                    .setApiKey(BuildConfig.FCM_API_KEY)
                    .build()
                FirebaseApp.initializeApp(app, options)
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    /** 알림을 그려도 되는지(안드로이드 13+ 권한, 앱 알림 전체 끔 포함). */
    fun canPost(context: Context): Boolean {
        val app = context.applicationContext
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(app, PERMISSION) != PackageManager.PERMISSION_GRANTED) return false
        return NotificationManagerCompat.from(app).areNotificationsEnabled()
    }

    /** 권한을 물어야 하는지(안드로이드 13+에서 아직 허용 안 됨). */
    fun needsAsk(context: Context): Boolean =
        Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context.applicationContext, PERMISSION) != PackageManager.PERMISSION_GRANTED

    fun enabled(context: Context): Boolean =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ON, false)

    fun setEnabled(context: Context, on: Boolean) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ON, on).apply()
    }

    /** 웹에 알릴 지금 상태. null이면 토큰을 받아 PushRules.onMessage로 알린다. */
    fun state(context: Context): String? = PushRules.state(init(context), enabled(context), canPost(context))

    fun channels(context: Context) {
        val nm = context.applicationContext.getSystemService(NotificationManager::class.java) ?: return
        for ((kind, name) in PushRules.KINDS) {
            val id = PushRules.channelId(kind)
            if (nm.getNotificationChannel(id) != null) continue
            val importance = if (PushRules.urgent(kind)) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT
            nm.createNotificationChannel(NotificationChannel(id, name, importance).apply {
                lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
                setShowBadge(true)
            })
        }
    }

    /** 받은 알림 하나를 그린다. 누르면 MainActivity가 그 자리(open)를 연다. */
    fun show(context: Context, m: PushRules.Message) {
        val app = context.applicationContext
        if (!canPost(app)) return
        channels(app)
        val id = PushRules.notifyId(m)
        val open = Intent(app, MainActivity::class.java)
            .setAction(PushRules.ACTION_OPEN)
            .putExtra(PushRules.EXTRA_OPEN, m.open)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val tap = PendingIntent.getActivity(app, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val priority = if (m.urgent) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT
        val hidden = NotificationCompat.Builder(app, m.channel)
            .setSmallIcon(R.drawable.ic_push)
            .setContentTitle(PushRules.PUBLIC_TITLE)
            .setPriority(priority)
            .build()
        val note = NotificationCompat.Builder(app, m.channel)
            .setSmallIcon(R.drawable.ic_push)
            .setContentTitle(m.title)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setPriority(priority)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(hidden)
            .build()
        try {
            app.getSystemService(NotificationManager::class.java)?.notify(id, note)
        } catch (_: SecurityException) {
        }
    }
}
