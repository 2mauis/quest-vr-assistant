package com.example.questvr.tunnelprobe

import com.example.questvr.display.PairingClient
import com.example.questvr.display.SessionKeeper

/** Process-wide HTTP state: one connection pool for pairing and renewal. */
object DisplayServices {
    val pairing: PairingClient by lazy { PairingClient() }

    fun sessionKeeper(): SessionKeeper = SessionKeeper(refresh = pairing::refresh)
}

/** Debug builds route shell-only broadcasts to the live workspace; always null in release. */
object WorkspaceDebugHook {
    var command: ((String) -> Unit)? = null
}
