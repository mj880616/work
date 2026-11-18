package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * S62-34 APP-플레이스토어비공개테스트: 두 판(github·play)의 판별 값을 고정한다.
 * 같은 시험을 두 판에서 각각 돈다(testGithub…UnitTest·testPlay…UnitTest). 권한이 실제로 빠졌는지는
 * android-app/scripts/check-flavor-manifests.sh가 빌드된 APK·AAB의 매니페스트로 본다.
 */
class FlavorTest {
    private val play = BuildConfig.APPLICATION_ID == "com.nojoplus.app"

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
            assertEquals(" KPTUPlay", BuildConfig.UA_MARK)
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
    fun playManifestRemovesExactlyTheThreePermissions() {
        // 플레이 판에서만 빼는 권한(스스로 업데이트 둘 + '모든 파일 접근'). 다른 권한은 main 매니페스트 그대로다.
        val text = File("src/play/AndroidManifest.xml").readText()
        val removed = Regex("""<uses-permission android:name="([^"]+)" tools:node="remove" />""").findAll(text).map { it.groupValues[1] }.toSet()
        assertEquals(
            setOf(
                "android.permission.REQUEST_INSTALL_PACKAGES",
                "android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION",
                "android.permission.MANAGE_EXTERNAL_STORAGE",
            ),
            removed,
        )
        // 앱 구성 요소(화면·서비스·받는 곳)는 판마다 바꾸지 않는다.
        assertFalse(text.contains("<application"))
    }
}
