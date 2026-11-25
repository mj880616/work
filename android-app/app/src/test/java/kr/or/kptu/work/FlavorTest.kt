package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * S62-34 APP-플레이스토어비공개테스트: 두 판(github·play)의 판별 값을 고정한다.
 * 같은 시험을 두 판에서 각각 돈다(testGithub…UnitTest·testPlay…UnitTest). 권한이 실제로 빠졌는지는
 * android-app/scripts/check-flavor-manifests.py가 빌드된 APK·AAB의 매니페스트로 본다.
 */
class FlavorTest {
    private val play = BuildConfig.APPLICATION_ID == "com.workonplus.app"

    @Test
    fun applicationIdIsOneOfTheTwo() {
        assertTrue(BuildConfig.APPLICATION_ID == "kr.or.kptu.work" || play)
    }

    @Test
    fun flavorValuesMatchTheApplicationId() {
        if (play) {
            assertFalse(BuildConfig.SELF_UPDATE)
            assertFalse(BuildConfig.ALL_FILES)
            assertEquals("android-play", BuildConfig.LOGIN_RETURN)
            assertEquals(" WorkOnPlay", BuildConfig.UA_MARK)
        } else {
            // github 판은 지금까지와 같다.
            assertTrue(BuildConfig.SELF_UPDATE)
            assertTrue(BuildConfig.ALL_FILES)
            assertEquals("android", BuildConfig.LOGIN_RETURN)
            assertEquals("", BuildConfig.UA_MARK)
        }
    }

    @Test
    fun shareOutAuthorityFollowsTheApplicationId() {
        // 두 판을 한 폰에 같이 깔아도 FileProvider 이름이 부딪히지 않는다. github 판은 옛 이름 그대로.
        assertEquals(BuildConfig.APPLICATION_ID + ".shareout", ShareOut.AUTHORITY)
        if (!play) assertEquals("kr.or.kptu.work.shareout", ShareOut.AUTHORITY)
    }

    @Test
    fun foregroundAndGalleryFollowTheFlavor() {
        // S70-45: 플레이 판은 앞쪽 서비스·폰 사진 전체 보기를 쓰지 않는다. github 판은 그대로.
        assertEquals(!play, BuildConfig.FG_SERVICES)
        assertEquals(!play, BuildConfig.PHONE_GALLERY)
        if (play) assertEquals("photos:state:{\"access\":\"none\",\"off\":true}", PhoneMediaRules.OFF_MESSAGE)
    }

    @Test
    fun playManifestRemovesExactlyTheListedPermissions() {
        // 플레이 판에서만 빼는 권한: 스스로 업데이트 둘 + '모든 파일 접근'(S62-34), 앞쪽 서비스 셋 + 사진·동영상 여섯(S70-45). 다른 권한은 main 매니페스트 그대로다.
        val text = File("src/play/AndroidManifest.xml").readText()
        val removed = Regex("""<uses-permission android:name="([^"]+)" tools:node="remove" />""").findAll(text).map { it.groupValues[1] }.toSet()
        assertEquals(
            setOf(
                "android.permission.REQUEST_INSTALL_PACKAGES",
                "android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION",
                "android.permission.MANAGE_EXTERNAL_STORAGE",
                "android.permission.FOREGROUND_SERVICE",
                "android.permission.FOREGROUND_SERVICE_MICROPHONE",
                "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
                "android.permission.READ_MEDIA_IMAGES",
                "android.permission.READ_MEDIA_VIDEO",
                "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
                "android.permission.READ_EXTERNAL_STORAGE",
                "android.permission.ACCESS_MEDIA_LOCATION",
                "android.permission.MANAGE_MEDIA",
            ),
            removed,
        )
        // 앱 구성 요소(화면·서비스·받는 곳)는 판마다 지우지 않는다. 두 서비스의 앞쪽 서비스 종류 속성만 지운다.
        assertFalse(text.contains("<activity") || text.contains("<receiver") || text.contains("<provider"))
        assertFalse(Regex("""<service[^>]*tools:node=""").containsMatchIn(text))
        val stripped = Regex("""<service\s+android:name="([^"]+)"\s+tools:remove="android:foregroundServiceType" />""").findAll(text).map { it.groupValues[1] }.toSet()
        assertEquals(setOf("androidx.work.impl.foreground.SystemForegroundService", ".RecorderService"), stripped)
        // RECORD_AUDIO는 남긴다(앱이 켜진 동안 녹음).
        assertFalse(text.contains("RECORD_AUDIO"))
    }
}
