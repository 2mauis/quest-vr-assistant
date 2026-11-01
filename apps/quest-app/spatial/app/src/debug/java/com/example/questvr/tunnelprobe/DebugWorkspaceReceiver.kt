package com.example.questvr.tunnelprobe

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Shell-only, debug-only inspection without opening an Activity or stealing XR focus. */
class DebugWorkspaceReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val operation = intent.getStringExtra("operation") ?: return
        if (operation in setOf("dump", "recenter", "open_grok", "expire_session")) {
            WorkspaceRuntime.debugCommand?.invoke(operation)
        }
    }
}
