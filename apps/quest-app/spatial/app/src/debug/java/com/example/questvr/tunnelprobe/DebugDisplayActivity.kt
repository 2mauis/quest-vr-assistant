package com.example.questvr.tunnelprobe

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.example.questvr.display.DisplayEndpoint
import com.example.questvr.display.PairingRejected
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.IOException

/** ADB-only development pairing. Never accepts a credential in an Intent or retains the inbox. */
class DebugDisplayActivity : Activity() {
    private val scope = MainScope()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent.getBooleanExtra("restore_only", false)) {
            openWorkspace(openGrok = false)
            finish()
            return
        }
        scope.launch {
            try {
                val input = withContext(Dispatchers.IO) { takeInbox() }
                if (input == null) {
                    Log.i(TAG, "debug_pairing=missing_input")
                    return@launch
                }
                val endpoint = DisplayEndpoint.parse(input.getString("endpoint"), allowLocal = true)
                val session = DisplayServices.pairing.pair(endpoint, input.getString("pairing_token"))
                DisplaySessionStore(this@DebugDisplayActivity).save(session)
                Log.i(TAG, "debug_pairing=paired")
                openWorkspace(openGrok = true)
            } catch (error: PairingRejected) {
                Log.i(TAG, "debug_pairing=failed kind=rejected status=${error.status}")
            } catch (error: IOException) {
                Log.i(TAG, "debug_pairing=failed kind=${error.javaClass.simpleName}")
            } catch (error: JSONException) {
                Log.i(TAG, "debug_pairing=failed kind=input")
            } catch (error: IllegalArgumentException) {
                Log.i(TAG, "debug_pairing=failed kind=input")
            } finally {
                finish()
            }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    /** Reads and always deletes the one-shot inbox written over ADB. */
    private fun takeInbox(): JSONObject? {
        val inbox = File(filesDir, "display-pairing-once.json")
        return try {
            if (!inbox.isFile || inbox.length() !in 1..MAX_INBOX_BYTES) null else JSONObject(inbox.readText())
        } catch (_: JSONException) {
            null
        } catch (_: IOException) {
            null
        } finally {
            inbox.delete()
        }
    }

    private fun openWorkspace(openGrok: Boolean) {
        val intent =
            Intent(this, WorkspaceActivity::class.java)
                .setAction(Intent.ACTION_MAIN)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (openGrok) intent.putExtra(WorkspaceActivity.OPEN_GROK, true)
        startActivity(intent)
    }

    private companion object {
        const val TAG = "QvrWorkspace"
        const val MAX_INBOX_BYTES = 4096L
    }
}
