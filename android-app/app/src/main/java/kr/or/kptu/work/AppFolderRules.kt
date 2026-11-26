package kr.or.kptu.work

/**
 * S68-02(11/22 사용자 결정): 앱이 폰 사진첩에 만드는 폴더 이름. 새 사용자는 'WORK ON+', 사용자 화면(운영자 기능 nojo_words)은 지금 이름 '노조+'.
 * 데이터 안전이 먼저: 이미 있는 'Pictures/노조+'(또는 'Movies/노조+')에 사진이 있으면 그 폴더를 계속 쓰고, 폴더를 바꾸거나 옮기지 않는다.
 * 그 폴더가 없을 때만 고른다: nojo_words면 '노조+', 아니면(모름 포함) 'WORK ON+'.
 *   모름(위젯 로그인이 없어 서버 기능 목록을 아직 못 받음)을 새 이름으로 보는 까닭: 앱만 쓰는 새 사용자가 계속 옛 이름을 받지 않게.
 *   기존 사용자(사용자 포함)는 위의 '이미 있는 폴더' 확인으로 지켜진다. nojo_words 값은 위젯 갱신이 서버 app_my_features로 받아 둔다(AppFolders).
 * 안드로이드 API 없이 JVM 단위 시험으로 고정한다(AppFolderRulesTest).
 */
object AppFolderRules {
    const val OLD = "노조+"
    const val NEW = "WORK ON+"
    const val NOJO_WORDS = "nojo_words"

    fun pick(oldExists: Boolean, nojoWords: Boolean?): String = if (oldExists || nojoWords == true) OLD else NEW

    fun pictures(name: String): String = "Pictures/$name/"
    fun movies(name: String): String = "Movies/$name/"

    /** 앱 폴더를 가리키는 상대 경로(옛·새 이름, 사진·동영상)인가. 웹이 원래 폴더를 모를 때 보내는 기본값('Pictures/노조+/')도 여기에 든다. */
    fun isAppDir(dir: String): Boolean = dir in listOf(pictures(OLD), pictures(NEW), movies(OLD), movies(NEW))

    /**
     * 저장할 상대 경로. dir == null(편집용 한 장 받기)이면 앱 사진 폴더, 앱 폴더를 가리키면 이 사람의 앱 폴더(사진/동영상은 dir 쪽을 따름),
     * 그 밖(원래 폴더 'DCIM/Camera/' 등)은 그대로.
     */
    fun resolve(dir: String?, home: String): String = when {
        dir == null -> pictures(home)
        !isAppDir(dir) -> dir
        dir.startsWith("Movies/") -> movies(home)
        else -> pictures(home)
    }

    /** 서버 app_my_features 답(글자 목록) → nojo_words가 있나. 목록이 아니면 null(모름). */
    fun nojoWordsOf(status: Int, body: Any?): Boolean? {
        if (status != 200 || body !is List<*>) return null
        return body.any { it == NOJO_WORDS }
    }
}
