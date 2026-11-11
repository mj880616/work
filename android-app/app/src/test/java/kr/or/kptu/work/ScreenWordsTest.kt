package kr.or.kptu.work

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 화면에 보이는 글자(Kotlin 따옴표 글자·res·매니페스트)에 옛 이름 '정리함'·'바구니'가 남지 않는다.
 * 웹 메뉴 이름이 '잊지 말기'로 바뀐 뒤(HOME-잊지말기한목록, 앱 쪽은 S59-4) 앱도 같은 이름을 쓴다.
 * 주석·코드 이름(변수·키)은 세지 않는다.
 */
class ScreenWordsTest {
    private val oldNames = listOf("정리함", "바구니")

    @Test
    fun kotlinScreenTextHasNoOldNames() {
        val dir = File("src/main/java/kr/or/kptu/work")
        val files = requireNotNull(dir.listFiles()).filter { it.name.endsWith(".kt") }
        assertTrue(files.size > 10)
        val found = ArrayList<String>()
        for (file in files) {
            file.readLines().forEachIndexed { index, line ->
                val trimmed = line.trim()
                if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return@forEachIndexed
                val code = line.substringBefore(" // ")
                for (literal in Regex("\"[^\"]*\"").findAll(code)) {
                    if (oldNames.any { literal.value.contains(it) }) found.add(file.name + ":" + (index + 1) + " " + literal.value)
                }
            }
        }
        assertTrue(found.joinToString("\n"), found.isEmpty())
    }

    @Test
    fun resourceAndManifestTextHasNoOldNames() {
        val comment = Regex("<!--[\\s\\S]*?-->")
        val files = ArrayList<File>()
        File("src/main/res").walkTopDown().filter { it.isFile && it.name.endsWith(".xml") }.forEach { files.add(it) }
        files.add(File("src/main/AndroidManifest.xml"))
        assertTrue(files.size > 10)
        val found = ArrayList<String>()
        for (file in files) {
            val text = comment.replace(file.readText(), "")
            for (word in oldNames) if (text.contains(word)) found.add(file.path + " " + word)
        }
        assertTrue(found.joinToString("\n"), found.isEmpty())
    }
}
