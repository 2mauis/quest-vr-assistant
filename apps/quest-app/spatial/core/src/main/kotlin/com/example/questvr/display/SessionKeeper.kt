package com.example.questvr.display

import kotlinx.coroutines.delay
import java.io.IOException
import kotlin.random.Random

/**
 * Keeps a stored session fresh for the display page. The page itself only receives the
 * short session token; the device grant never leaves the shell.
 */
class SessionKeeper(
    private val refresh: suspend (DisplaySession) -> DisplaySession,
    private val clock: () -> Long = System::currentTimeMillis,
    private val random: Random = Random.Default,
) {
    /**
     * Renews ahead of expiry and passes each renewed session to [onRenewed]. Returns only when
     * the user has to pair again: there is no usable device grant or the relay rejected it.
     * Transient failures retry with backoff; cancellation stops it at any point.
     */
    suspend fun keep(
        initial: DisplaySession,
        onRenewed: suspend (DisplaySession) -> Unit,
    ) {
        var session = initial
        var failures = 0
        while (true) {
            val wait = renewalDelay(session, clock()) ?: return
            if (wait > 0) delay(wait)
            if (!session.canRefresh(clock())) return
            session =
                try {
                    refresh(session).also { failures = 0 }
                } catch (error: PairingRejected) {
                    if (error.status in TERMINAL_STATUSES) return
                    delay(if (error.status == 429) RATE_LIMIT_DELAY_MS else retryDelay(failures++))
                    continue
                } catch (_: IOException) {
                    delay(retryDelay(failures++))
                    continue
                }
            onRenewed(session)
        }
    }

    /** Milliseconds until [session] should be renewed, 0 for now, or null when it cannot be. */
    fun renewalDelay(
        session: DisplaySession,
        now: Long,
    ): Long? {
        if (!session.canRefresh(now)) return if (session.expiresAt > now) session.expiresAt - now else null
        val remaining = session.expiresAt - now
        if (remaining <= 0) return 0
        // Short-lived sessions renew at half their remaining time instead of in a tight loop.
        return remaining - minOf(RENEWAL_MARGIN_MS, remaining / 2)
    }

    fun retryDelay(attempt: Int): Long {
        val base = (1000L shl attempt.coerceIn(0, 5)).coerceAtMost(MAX_RETRY_DELAY_MS)
        return (base * random.nextDouble(0.8, 1.2)).toLong()
    }

    companion object {
        const val RENEWAL_MARGIN_MS = 60_000L
        const val RATE_LIMIT_DELAY_MS = 60_000L
        const val MAX_RETRY_DELAY_MS = 30_000L
        private val TERMINAL_STATUSES = setOf(400, 401, 403, 404)
    }
}
