package kr.or.kptu.work

import android.content.Context
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * APP-폰알림 N4(설계 docs/design/phone-notifications.md 4.4절): 서버(phone-push)가 보낸 데이터 메시지(kind·title·open)를 받아 알림을 그린다.
 * 매니페스트의 MESSAGING_EVENT 선언은 이 서비스 하나다(내보내지 않음, 구글 Play 서비스만 보냄).
 * - 새 토큰(onNewToken)은 서버에 직접 보내지 않는다. 다음에 웹2 화면이 열리면 다리(push:hello) → 웹 화면이 웹 세션으로 등록한다.
 * - '이 폰 끊기'를 한 폰(이 폰에서 받기 꺼짐)은 받아도 그리지 않는다.
 * 토큰은 로그·화면에 출력하지 않는다(웹 화면에만 다리로 넘김).
 */
class PushService : FirebaseMessagingService() {
    override fun onCreate() {
        PushSetup.init(applicationContext)
        super.onCreate()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val m = PushRules.message(message.data) ?: return
        if (!PushSetup.enabled(applicationContext)) return
        PushSetup.show(applicationContext, m)
    }

    override fun onNewToken(token: String) {
        // 서버 등록은 웹 화면이 한다(앱은 로그인 토큰을 만지지 않음, 상위 설계 4.2).
    }

    companion object {
        /** 이 폰의 토큰. 설정이 없거나 못 받으면 null. done은 메인 스레드에서 불린다. */
        fun token(context: Context, done: (String?) -> Unit) {
            if (!PushSetup.init(context)) {
                done(null)
                return
            }
            try {
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    val value = if (task.isSuccessful) task.result else null
                    done(value?.takeIf { PushRules.tokenOk(it) })
                }
            } catch (_: Exception) {
                done(null)
            }
        }

        /** 이 폰의 토큰을 지운다(이 폰 끊기). 끝나면 done. */
        fun forget(context: Context, done: () -> Unit) {
            if (!PushSetup.init(context)) {
                done()
                return
            }
            try {
                FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener { done() }
            } catch (_: Exception) {
                done()
            }
        }
    }
}
