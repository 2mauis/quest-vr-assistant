package com.example.questvr.display

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/**
 * Protocol reducer kept for unit tests.
 * The spatial shell no longer presents with this engine; the web display page does.
 * No cursor survives process death.
 */
class DisplayEngine {
    var state = WorkspaceState(); private set
    var lastSeq = 0L; private set
    var server = ""; private set

    fun authenticate(serverId: String) {
        // The relay's process-scoped device ID prevents an old in-flight frame ACK on a new relay.
        if (server.isNotEmpty() && server != serverId) { state = WorkspaceState(); lastSeq = 0 }
        server = serverId
    }

    fun reset() { state = WorkspaceState(); lastSeq = 0; server = "" }

    suspend fun apply(message: Envelope, present: suspend (WorkspaceState) -> Unit): Long? {
        require(message.session == server) { "stale_server" }
        if (message.type != "snapshot") {
            if (message.seq <= lastSeq) return lastSeq
            require(message.seq == lastSeq + 1) { "sequence_gap" }
        }
        val next = DisplayProtocol.reduce(state, message)
        present(next) // Suspends until assets, Compose drawing and active spatial frames are ready.
        currentCoroutineContext().ensureActive()
        state = next
        lastSeq = message.seq
        return if (message.type == "snapshot") null else lastSeq
    }
}
