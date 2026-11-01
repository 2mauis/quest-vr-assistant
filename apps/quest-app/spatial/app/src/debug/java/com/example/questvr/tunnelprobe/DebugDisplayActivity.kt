package com.example.questvr.tunnelprobe

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.example.questvr.display.ConnectionStatus
import com.example.questvr.display.DisplayProtocol
import com.example.questvr.display.RelayClient
import com.example.questvr.display.PairingFailure
import java.io.File
import kotlinx.coroutines.*
import org.json.JSONObject

/** ADB-only development pairing. Never accepts a credential in an Intent or retains the inbox. */
class DebugDisplayActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent.getBooleanExtra("restore_only", false)) {
            startActivity(Intent(this, WorkspaceActivity::class.java)
                .setAction(Intent.ACTION_MAIN).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish(); return
        }
        val inbox = File(filesDir, "display-pairing-once.json")
        val input = try {
            require(inbox.isFile && inbox.length() in 1..4096)
            JSONObject(inbox.readText())
        } catch (_: Exception) {
            Log.i("QvrWorkspace", "debug_pairing=missing_input")
            finish(); return
        } finally { inbox.delete() }
        scope.launch {
            val client = RelayClient()
            try {
                val endpoint = DisplayProtocol.endpoint(input.getString("endpoint"), true)
                val session = client.pair(endpoint, input.getString("pairing_token"))
                val store = DisplaySessionStore(this@DebugDisplayActivity)
                if (store.endpoint != endpoint) WorkspaceRuntime.engine.reset()
                store.save(session)
                WorkspaceRuntime.connectionAllowed.value = true
                WorkspaceRuntime.explicitReconnectRequired = false
                WorkspaceRuntime.status.value = ConnectionStatus("paired", WorkspaceRuntime.engine.lastSeq)
                Log.i("QvrWorkspace", "debug_pairing=paired")
                startActivity(Intent(this@DebugDisplayActivity, WorkspaceActivity::class.java)
                    .setAction(Intent.ACTION_MAIN).putExtra(WorkspaceActivity.OPEN_GROK, true)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (error: Exception) {
                Log.i("QvrWorkspace", "debug_pairing=failed kind=${error.javaClass.simpleName} status=${(error as? PairingFailure)?.status ?: 0}")
            } finally { client.close(); finish() }
        }
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}
