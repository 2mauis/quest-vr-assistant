package com.example.questvr.tunnelprobe

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.example.questvr.display.*
import kotlinx.coroutines.launch
import java.io.File

class HomeActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = DisplaySessionStore(this)
        setContent {
            AssistantTheme {
                val scope = rememberCoroutineScope()
                val state by WorkspaceRuntime.status.collectAsState()
                var endpoint by remember { mutableStateOf(store.endpoint) }
                var token by remember { mutableStateOf("") }
                var paired by remember { mutableStateOf(store.load() != null) }
                var busy by remember { mutableStateOf(false) }
                var message by remember { mutableStateOf("") }
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(32.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text("QUEST ASSISTANT", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                        Text("空间工作区", style = MaterialTheme.typography.headlineLarge)
                        Text("让对话里的信息出现在身边。", style = MaterialTheme.typography.bodyLarge)
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text(statusText(state.phase), style = MaterialTheme.typography.titleMedium)
                                Text("工作区里的网页显示面板呈现三维内容。")
                                Button(onClick = {
                                    if (store.load() == null) { paired = false; message = "连接已过期，请重新配对。" }
                                    else {
                                        WorkspaceRuntime.explicitReconnectRequired = false
                                        startActivity(Intent(this@HomeActivity, WorkspaceActivity::class.java)
                                            .setAction(Intent.ACTION_MAIN).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                                    }
                                }, enabled = paired && !busy) {
                                    Text(if (state.phase == "taken_over") "切回此头显" else "进入空间工作区")
                                }
                            }
                        }
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text("Grok 对话", style = MaterialTheme.typography.titleMedium)
                                Text("宽屏网页沿用浏览器登录，与空间工作区并排显示。")
                                Button(onClick = {
                                    startActivity(Intent(this@HomeActivity, WorkspaceActivity::class.java)
                                        .setAction(Intent.ACTION_MAIN).putExtra(WorkspaceActivity.OPEN_GROK, true)
                                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                                }) { Text("打开 Grok 与工作区") }
                                TextButton(onClick = { startActivity(Intent(this@HomeActivity, WebActivity::class.java)) }) {
                                    Text("备用内嵌网页 · 独立登录")
                                }
                            }
                        }
                        OutlinedCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text("显示连接", style = MaterialTheme.typography.titleMedium)
                                Text("首次使用时填写显示地址和配对口令。开发连接使用 USB 转发。")
                                OutlinedTextField(endpoint, { endpoint = it }, label = { Text("显示地址") },
                                    singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
                                OutlinedTextField(token, { token = it }, label = { Text("配对口令") }, singleLine = true,
                                    visualTransformation = PasswordVisualTransformation(), enabled = !busy,
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
                                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Button(enabled = !busy && token.isNotBlank(), onClick = {
                                        busy = true; message = "正在配对…"
                                        val pairingToken = token; token = ""
                                        scope.launch {
                                            val client = RelayClient()
                                            try {
                                                val normalized = DisplayProtocol.endpoint(endpoint, BuildConfig.DEBUG)
                                                val session = client.pair(normalized, pairingToken)
                                                store.save(session); endpoint = normalized; paired = true
                                                WorkspaceRuntime.connectionAllowed.value = true
                                                WorkspaceRuntime.explicitReconnectRequired = false
                                                WorkspaceRuntime.status.value = ConnectionStatus("paired")
                                                message = "配对完成，可以进入工作区。"
                                            } catch (error: Exception) {
                                                message = when ((error as? PairingFailure)?.status) {
                                                    401 -> "配对口令不正确。"
                                                    429 -> "尝试过于频繁，请稍后再试。"
                                                    else -> "未能配对，请检查显示地址和连接。"
                                                }
                                            } finally { client.close(); busy = false }
                                        }
                                    }) { Text(if (busy) "连接中…" else "配对") }
                                    TextButton(enabled = !busy, onClick = {
                                        WorkspaceRuntime.connectionAllowed.value = false
                                        WorkspaceRuntime.explicitReconnectRequired = true
                                        store.clear(); paired = false; token = ""
                                        WorkspaceRuntime.status.value = ConnectionStatus("disconnected")
                                        message = "已移除此 App 的显示连接。"
                                    }) { Text("移除连接") }
                                }
                                if (message.isNotEmpty()) Text(message)
                            }
                        }
                        if (File(applicationInfo.nativeLibraryDir, "libcloudflared_probe.so").exists()) {
                            TextButton(onClick = { startActivity(Intent(this@HomeActivity, ProbeActivity::class.java)) }) {
                                Text("连接诊断")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun AssistantTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFF79D8EF), secondary = Color(0xFFB8C8FF),
        background = Color(0xFF0B1220), surface = Color(0xFF111D2D), surfaceVariant = Color(0xFF1B2C40)), content = content)
}

fun statusText(phase: String) = when (phase) {
    "paired" -> "已配对 · 等待进入工作区"
    "connecting" -> "正在连接显示服务"
    "connected" -> "工作区已连接"
    "reconnecting" -> "连接中断 · 正在重连"
    "paused" -> "工作区已暂停"
    "taken_over" -> "显示已被其他设备接管"
    "pairing_required" -> "需要重新配对"
    "render_failed" -> "内容未能呈现 · 请检查后重试"
    "queue_full" -> "待处理内容过多 · 请重新连接"
    else -> "尚未连接"
}
