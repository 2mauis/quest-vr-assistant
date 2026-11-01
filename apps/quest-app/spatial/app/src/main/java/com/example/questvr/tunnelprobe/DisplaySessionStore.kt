package com.example.questvr.tunnelprobe

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.example.questvr.display.DisplaySession
import com.example.questvr.display.ConnectionStatus
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONObject

/** Process state is separate from the short-lived encrypted pairing session. */
object WorkspaceRuntime {
    val status = MutableStateFlow(ConnectionStatus("disconnected"))
    val connectionAllowed = MutableStateFlow(true)
    var explicitReconnectRequired = false
    var debugCommand: ((String) -> Unit)? = null
}

class DisplaySessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("native_display", Context.MODE_PRIVATE)
    var endpoint: String
        get() = prefs.getString("endpoint", "http://localhost:8787")!!
        set(value) { prefs.edit().putString("endpoint", value).apply() }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "quest_assistant_display_session"
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    fun save(session: DisplaySession) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val data = JSONObject().put("endpoint", session.endpoint).put("token", session.token)
            .put("expires", session.expiresAt).put("refresh", session.refreshToken)
            .put("refreshExpires", session.refreshExpiresAt).toString().toByteArray(Charsets.UTF_8)
        val encrypted = cipher.doFinal(data)
        prefs.edit().putString("session", Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP))
            .putString("endpoint", session.endpoint).apply()
    }

    fun load(): DisplaySession? {
        val encoded = prefs.getString("session", null) ?: return null
        return try {
            val data = Base64.decode(encoded, Base64.NO_WRAP)
            require(data.size > 28)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(0, 12)))
            }
            val json = JSONObject(String(cipher.doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8))
            DisplaySession(json.getString("endpoint"), json.getString("token"), json.getLong("expires"),
                json.optString("refresh").takeIf { it.isNotEmpty() && it != "null" }, json.optLong("refreshExpires"))
                .takeIf { it.canRestore() }.also { if (it == null) clear() }
        } catch (_: Exception) { clear(); null }
    }
    fun clear() { prefs.edit().remove("session").apply() }
}
