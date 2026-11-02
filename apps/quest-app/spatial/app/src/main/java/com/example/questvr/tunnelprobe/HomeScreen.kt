package com.example.questvr.tunnelprobe

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

data class HomeState(
    val endpoint: String = "",
    val token: String = "",
    val paired: Boolean = false,
    val busy: Boolean = false,
    val message: String = "",
)

class HomeActions(
    val onEndpointChange: (String) -> Unit,
    val onTokenChange: (String) -> Unit,
    val onEnterWorkspace: () -> Unit,
    val onOpenGrok: () -> Unit,
    val onOpenEmbeddedWeb: () -> Unit,
    val onPair: () -> Unit,
    val onForget: () -> Unit,
    val onOpenDiagnostics: () -> Unit,
)

@Composable
fun AssistantTheme(content: @Composable () -> Unit) {
    val colors =
        darkColorScheme(
            primary = Color(0xFF79D8EF),
            secondary = Color(0xFFB8C8FF),
            background = Color(0xFF0B1220),
            surface = Color(0xFF111D2D),
            surfaceVariant = Color(0xFF1B2C40),
        )
    MaterialTheme(colorScheme = colors, content = content)
}

@Composable
fun HomeScreen(
    state: HomeState,
    actions: HomeActions,
    diagnosticsAvailable: Boolean,
) {
    Surface(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("QUEST ASSISTANT", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
            Text("空间工作区", style = MaterialTheme.typography.headlineLarge)
            Text("让对话里的信息出现在身边。", style = MaterialTheme.typography.bodyLarge)
            WorkspaceCard(state, actions)
            GrokCard(actions)
            ConnectionCard(state, actions)
            if (diagnosticsAvailable) TextButton(onClick = actions.onOpenDiagnostics) { Text("连接诊断") }
        }
    }
}

@Composable
private fun WorkspaceCard(
    state: HomeState,
    actions: HomeActions,
) {
    Card(Modifier.fillMaxWidth()) {
        CardColumn {
            Text(if (state.paired) "已配对 · 可以进入工作区" else "尚未配对", style = MaterialTheme.typography.titleMedium)
            Text("工作区里的网页显示面板呈现三维内容；被其他设备接管时，在面板里切回。")
            Button(onClick = actions.onEnterWorkspace, enabled = state.paired && !state.busy) { Text("进入空间工作区") }
        }
    }
}

@Composable
private fun GrokCard(actions: HomeActions) {
    Card(Modifier.fillMaxWidth()) {
        CardColumn {
            Text("Grok 对话", style = MaterialTheme.typography.titleMedium)
            Text("宽屏网页沿用浏览器登录，与空间工作区并排显示。")
            Button(onClick = actions.onOpenGrok) { Text("打开 Grok 与工作区") }
            TextButton(onClick = actions.onOpenEmbeddedWeb) { Text("备用内嵌网页 · 独立登录") }
        }
    }
}

@Composable
private fun ConnectionCard(
    state: HomeState,
    actions: HomeActions,
) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        CardColumn {
            Text("显示连接", style = MaterialTheme.typography.titleMedium)
            Text("首次使用时填写显示地址和配对口令。开发连接使用 USB 转发。")
            OutlinedTextField(
                state.endpoint,
                actions.onEndpointChange,
                label = { Text("显示地址") },
                singleLine = true,
                enabled = !state.busy,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                state.token,
                actions.onTokenChange,
                label = { Text("配对口令") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                enabled = !state.busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(enabled = !state.busy && state.token.isNotBlank(), onClick = actions.onPair) {
                    Text(if (state.busy) "连接中…" else "配对")
                }
                TextButton(onClick = actions.onForget) { Text("移除连接") }
            }
            if (state.message.isNotEmpty()) Text(state.message)
        }
    }
}

@Composable
private fun CardColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
}
