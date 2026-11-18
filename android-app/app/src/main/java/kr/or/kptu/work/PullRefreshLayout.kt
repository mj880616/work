package kr.or.kptu.work

import android.content.Context
import android.view.MotionEvent
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * NOTE-폴더고른뒤새로고침(11/18 21:25): 웹 화면을 감싸는 당겨서 새로고침. SwipeRefreshLayout과 같고, 지금 받는 손가락 사건이
 * 움직임(MOVE)인지만 알려 준다 — MainActivity가 움직이는 순간에만 당기기를 막도록(ShellRules.pullBlocked).
 */
class PullRefreshLayout(context: Context) : SwipeRefreshLayout(context) {
    /** 지금 나눠 주는 손가락 사건이 움직임인지. */
    var moving = false
        private set

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        moving = ev.actionMasked == MotionEvent.ACTION_MOVE
        return super.dispatchTouchEvent(ev)
    }
}
