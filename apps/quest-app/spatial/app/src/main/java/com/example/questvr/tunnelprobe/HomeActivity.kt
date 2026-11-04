package com.example.questvr.tunnelprobe

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import com.example.questvr.display.DisplayEndpoint
import com.example.questvr.display.InvalidPairingResponse
import com.example.questvr.display.PairingRejected
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.io.File
import java.io.IOException

/** 2D launcher: pairing, entry into the spatial workspace and the Grok window. */
class HomeActivity : ComponentActivity() {
    private val store by lazy { DisplaySessionStore(this) }
    private var state by mutableStateOf(HomeState())
    private var pairing: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val actions =
            HomeActions(
                onEndpointChange = { state = state.copy(endpoint = it) },
                onTokenChange = { state = state.copy(token = it) },
                onEnterWorkspace = ::enterWorkspace,
                onOpenGrok = { startWorkspace(openGrok = true) },
                onOpenEmbeddedWeb = { startActivity(Intent(this, WebActivity::class.java)) },
                onPair = ::pair,
                onForget = ::forget,
                onOpenDiagnostics = { startActivity(Intent(this, ProbeActivity::class.java)) },
            )
        val diagnostics = File(applicationInfo.nativeLibraryDir, "libcloudflared_probe.so").exists()
        setContent { AssistantTheme { HomeScreen(state, actions, diagnosticsAvailable = diagnostics) } }
        lifecycleScope.launch { state = state.copy(endpoint = store.endpointText()) }
    }

    override fun onResume() {
        super.onResume()
        // The workspace clears the session when the grant is rejected, so re-read it here.
        lifecycleScope.launch { state = state.copy(paired = store.load() != null) }
    }

    private fun enterWorkspace() {
        lifecycleScope.launch {
            if (store.load() == null) {
                state = state.copy(paired = false, message = "连接已过期，请重新配对。")
            } else {
                startWorkspace(openGrok = false)
            }
        }
    }

    private fun startWorkspace(openGrok: Boolean) {
        val intent =
            Intent(this, WorkspaceActivity::class.java)
                .setAction(Intent.ACTION_MAIN)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (openGrok) intent.putExtra(WorkspaceActivity.OPEN_GROK, true)
        startActivity(intent)
    }

    private fun pair() {
        if (pairing?.isActive == true) return
        val pairingToken = state.token
        state = state.copy(token = "", busy = true, message = "正在配对…")
        pairing =
            lifecycleScope.launch {
                val message =
                    try {
                        val endpoint = DisplayEndpoint.parse(state.endpoint, allowLocal = BuildConfig.DEBUG)
                        store.save(DisplayServices.pairing.pair(endpoint, pairingToken))
                        state = state.copy(endpoint = endpoint.origin, paired = true)
                        "配对完成，可以进入工作区。"
                    } catch (error: PairingRejected) {
                        when (error.status) {
                            401 -> "配对口令不正确。"
                            429 -> "尝试过于频繁，请稍后再试。"
                            else -> "显示服务拒绝了配对（${error.status}）。"
                        }
                    } catch (_: InvalidPairingResponse) {
                        "显示服务的回应无效，请检查显示地址。"
                    } catch (_: IOException) {
                        "未能连接显示服务，请检查显示地址和网络。"
                    } catch (_: IllegalArgumentException) {
                        "显示地址或配对口令格式不正确。"
                    }
                state = state.copy(busy = false, message = message)
            }
    }

    private fun forget() {
        pairing?.cancel()
        lifecycleScope.launch {
            store.clear()
            state = state.copy(paired = false, busy = false, token = "", message = "已移除此 App 的显示连接。")
        }
    }
}
