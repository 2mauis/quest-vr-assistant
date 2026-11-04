package com.example.questvr.tunnelprobe

import android.app.Activity
import android.app.ActivityManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** A wide, separate panel task. The browser owns the page, login and microphone. */
class GrokWindowActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null && isRecreatedAboveRetainedBrowser()) {
            finish()
            return
        }
        setContent {
            AssistantTheme {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.padding(32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text("Grok 对话", style = MaterialTheme.typography.headlineLarge)
                        Text("网页与空间工作区并排显示，沿用浏览器登录。")
                        Button(onClick = { BrowserPage.open(this@GrokWindowActivity) }) { Text("打开 Grok") }
                        TextButton(onClick = { finishAndRemoveTask() }) { Text("关闭对话窗口") }
                    }
                }
            }
        }
        if (savedInstanceState == null) BrowserPage.open(this)
    }

    /**
     * A browser Activity can survive our process or an update while its original root is gone.
     * NEW_TASK brings that task back but recreates this root above the retained Custom Tab;
     * finishing only the new root lets the existing conversation resume without another tab.
     */
    private fun isRecreatedAboveRetainedBrowser(): Boolean {
        val task =
            getSystemService(ActivityManager::class.java)
                .appTasks
                .firstOrNull { it.taskInfo.taskId == taskId }
                ?.taskInfo ?: return false
        val base = task.baseActivity?.packageName ?: return false
        return task.numActivities > 1 && base != packageName
    }

    companion object {
        /**
         * Requests an overlay in the current immersive environment. Moving a Home task directly
         * to front (or LAUNCH_ADJACENT) can switch Home in and stop the XR scene. NEW_TASK reuses
         * this affinity's task without clearing the browser above its root.
         */
        fun open(activity: Activity) {
            activity.startActivity(
                Intent(activity, GrokWindowActivity::class.java)
                    .setAction(Intent.ACTION_MAIN)
                    .addCategory("com.oculus.intent.category.2D")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }
}
