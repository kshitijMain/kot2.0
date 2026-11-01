package com.rp.mobilenative

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * [WifiRoute] from JavaScript (P9-27): start watching the Wi-Fi, re-check the route with the
 * restaurant PC's candidate addresses, and `onChange` whenever the Wi-Fi gains or loses internet
 * or the app is bound to it or let go.
 */
class RpWifiRouteModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RpWifiRoute")

    Events(CHANGE)

    OnCreate { WifiRoute.listener = { state -> sendEvent(CHANGE, state) } }

    OnDestroy { WifiRoute.listener = null }

    /** Starts watching the Wi-Fi (once); `{ wifiWithoutInternet, bound }`. */
    AsyncFunction("start") { WifiRoute.start(context()) }

    /** Re-checks the route with the PC's candidate addresses; `{ wifiWithoutInternet, bound }`. */
    AsyncFunction("route") { serverUrls: List<String> -> WifiRoute.route(context(), serverUrls) }
  }

  private fun context(): Context =
    appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  private companion object {
    const val CHANGE = "onChange"
  }
}
