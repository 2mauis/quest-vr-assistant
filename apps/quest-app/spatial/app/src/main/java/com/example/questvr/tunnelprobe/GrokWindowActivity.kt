package com.example.questvr.tunnelprobe

import android.app.Activity
import android.app.ActivityManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** A wide, separate panel task. The browser owns the page, login and microphone. */
class GrokWindowActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A browser Activity can survive our process/update while its original root is removed.
        // NEW_TASK brings that task back, but recreates this root above the retained Custom Tab.
        // Remove only the new root so the existing conversation resumes without another tab.
        val task = getSystemService(ActivityManager::class.java).appTasks
            .firstOrNull { it.taskInfo.taskId == taskId }?.taskInfo
        if (savedInstanceState == null && task != null && task.numActivities > 1 &&
            task.baseActivity?.packageName?.let { it != packageName } == true) {
            finish(); return
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

    companion object {
        fun open(activity: Activity) {
            // Request an overlay in the current immersive environment. Moving a Home task
            // directly to front (or LAUNCH_ADJACENT) can switch Home in and stop the XR scene.
            // NEW_TASK reuses this affinity's task without clearing the browser above its root.
            activity.startActivity(Intent(activity, GrokWindowActivity::class.java)
                .setAction(Intent.ACTION_MAIN).addCategory("com.oculus.intent.category.2D")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
