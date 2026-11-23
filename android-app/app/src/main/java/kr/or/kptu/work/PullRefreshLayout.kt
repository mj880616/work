package kr.or.kptu.work

import android.content.Context
import android.view.MotionEvent
import android.view.ViewConfiguration
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * NOTE-폴더고른뒤새로고침(11/18 21:25): 웹 화면을 감싸는 당겨서 새로고침. SwipeRefreshLayout과 같고, 지금 받는 손가락 사건이
 * 움직임(MOVE)인지만 알려 준다 — MainActivity가 움직이는 순간에만 당기기를 막도록(ShellRules.pullBlocked).
 * S68-59: 옆으로 가는 손가락(ShellRules.pullAxis)은 끝날 때까지 가로채지 않는다 — 웹 목록 줄 밀기·탭 넘김이 끊기지 않게.
 */
class PullRefreshLayout(context: Context) : SwipeRefreshLayout(context) {
    /** 지금 나눠 주는 손가락 사건이 움직임인지. */
    var moving = false
        private set

    private val slop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
    private var downX = 0f
    private var downY = 0f
    /** 이 손가락의 갈래: null = 아직 모름, true = 옆, false = 위아래. 손가락을 댈 때마다 새로 정한다. */
    private var sideways: Boolean? = null

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        moving = ev.actionMasked == MotionEvent.ACTION_MOVE
        return super.dispatchTouchEvent(ev)
    }

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = ev.x
                downY = ev.y
                sideways = null
            }
            MotionEvent.ACTION_MOVE -> if (sideways == null) sideways = ShellRules.pullAxis(ev.x - downX, ev.y - downY, slop)
        }
        if (sideways == true) return false
        return super.onInterceptTouchEvent(ev)
    }
}
