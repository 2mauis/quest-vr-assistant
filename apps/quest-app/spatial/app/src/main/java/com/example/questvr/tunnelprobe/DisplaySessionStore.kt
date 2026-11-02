package com.example.questvr.tunnelprobe

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.example.questvr.display.DisplayEndpoint
import com.example.questvr.display.DisplaySession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The paired display session, encrypted with a non-exportable Keystore key. All calls do
 * disk and Keystore work on the IO dispatcher, so they are safe from the main thread.
 */
class DisplaySessionStore(
    context: Context,
) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    suspend fun endpointText(): String = io { prefs.getString(KEY_ENDPOINT, null) ?: DEFAULT_ENDPOINT }

    suspend fun load(): DisplaySession? =
        io {
            val encoded = prefs.getString(KEY_SESSION, null) ?: return@io null
            val session =
                try {
                    decode(decrypt(Base64.decode(encoded, Base64.NO_WRAP)))
                } catch (_: GeneralSecurityException) {
                    null
                } catch (_: JSONException) {
                    null
                } catch (_: IllegalArgumentException) {
                    null
                }
            session?.takeIf { it.canRestore(System.currentTimeMillis()) } ?: run {
                removeSession()
                null
            }
        }

    suspend fun save(session: DisplaySession) =
        io {
            val encrypted = encrypt(encode(session))
            prefs
                .edit()
                .putString(KEY_SESSION, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString(KEY_ENDPOINT, session.endpoint.origin)
                .commit()
        }

    suspend fun clear() = io { removeSession() }

    private fun removeSession() {
        prefs.edit().remove(KEY_SESSION).commit()
    }

    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { lock.withLock { block() } }

    private fun encode(session: DisplaySession): ByteArray =
        JSONObject()
            .put("endpoint", session.endpoint.origin)
            .put("token", session.token)
            .put("expires", session.expiresAt)
            .put("refresh", session.refreshToken ?: JSONObject.NULL)
            .put("refreshExpires", session.refreshExpiresAt)
            .toString()
            .toByteArray(Charsets.UTF_8)

    private fun decode(data: ByteArray): DisplaySession {
        val json = JSONObject(String(data, Charsets.UTF_8))
        val token = json.getString("token")
        require(DisplaySession.isSessionToken(token)) { "stored_token" }
        return DisplaySession(
            endpoint = DisplayEndpoint.parse(json.getString("endpoint"), BuildConfig.DEBUG),
            token = token,
            expiresAt = json.getLong("expires"),
            refreshToken = if (json.isNull("refresh")) null else json.getString("refresh"),
            refreshExpiresAt = json.optLong("refreshExpires"),
        )
    }

    private fun encrypt(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        return cipher.iv + cipher.doFinal(plain)
    }

    private fun decrypt(data: ByteArray): ByteArray {
        require(data.size > IV_BYTES + TAG_BYTES) { "stored_session" }
        val cipher =
            Cipher.getInstance(TRANSFORMATION).apply {
                init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BYTES * 8, data, 0, IV_BYTES))
            }
        return cipher.doFinal(data, IV_BYTES, data.size - IV_BYTES)
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val spec =
            KeyGenParameterSpec
                .Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).apply { init(spec) }.generateKey()
    }

    private companion object {
        const val PREFS = "native_display"
        const val KEY_ENDPOINT = "endpoint"
        const val KEY_SESSION = "session"
        const val DEFAULT_ENDPOINT = "http://localhost:8787"
        const val KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "quest_assistant_display_session"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BYTES = 16

        /** One lock for every instance: Activities create their own store over the same file. */
        val lock = Mutex()
    }
}
