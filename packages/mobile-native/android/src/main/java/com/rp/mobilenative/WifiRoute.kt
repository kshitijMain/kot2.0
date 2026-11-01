package com.rp.mobilenative

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import java.net.InetSocketAddress
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The app's own traffic over a Wi-Fi without internet (P9-27, NFR-A01). Restaurants sometimes run
 * the POS on a Wi-Fi with no internet; Android then sends the app's traffic over mobile data, where
 * the restaurant PC cannot be reached. While the Wi-Fi is not validated for internet
 * (`NET_CAPABILITY_VALIDATED` missing) and the restaurant PC answers on it, the app's process is
 * bound to the Wi-Fi (`bindProcessToNetwork`): the app talks to the PC over Wi-Fi and the rest of
 * the phone keeps mobile data. It is unbound when the Wi-Fi has internet again or goes away.
 *
 * The Wi-Fi is asked for with `requestNetwork` for TRANSPORT_WIFI without requiring INTERNET, so
 * Android keeps it up for the app even without internet. Every check runs on one thread: a check
 * may open a TCP connection to the PC through the Wi-Fi.
 */
object WifiRoute {
  private const val PROBE_TIMEOUT_MS = 1_500

  private val worker = Executors.newSingleThreadExecutor()
  private var connectivity: ConnectivityManager? = null
  private var started = false

  @Volatile private var wifi: Network? = null
  @Volatile private var validated = false
  @Volatile private var bound: Network? = null

  /** The PC's candidate addresses, `host` and `port`; empty while none is known. */
  private var targets: List<Pair<String, Int>> = emptyList()

  /** Told of every change of [state] (the module sends it to JavaScript). */
  @Volatile var listener: ((Map<String, Any>) -> Unit)? = null

  private val callback =
    object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        worker.execute {
          if (network != wifi) validated = false
          wifi = network
          evaluate()
        }
      }

      override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
        worker.execute {
          wifi = network
          validated = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
          evaluate()
        }
      }

      override fun onLost(network: Network) {
        worker.execute {
          if (network == wifi) {
            wifi = null
            validated = false
          }
          evaluate()
        }
      }
    }

  /** Starts watching the Wi-Fi, once; returns the state. */
  @Synchronized
  fun start(context: Context): Map<String, Any> {
    if (!started) {
      started = true
      val manager =
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE)
          as ConnectivityManager
      connectivity = manager
      val request =
        NetworkRequest.Builder()
          .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
          .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
          .build()
      try {
        manager.requestNetwork(request, callback)
      } catch (e: RuntimeException) {
        // No permission or too many requests: the app keeps Android's default route.
        started = false
        connectivity = null
      }
    }
    return state()
  }

  /**
   * Re-checks the route with the PC's candidate addresses (`https://host:port`) and returns the
   * state once done. Called before the app tries those addresses.
   */
  fun route(context: Context, serverUrls: List<String>): Map<String, Any> {
    start(context)
    val parsed = serverUrls.mapNotNull { targetOf(it) }
    return worker
      .submit<Map<String, Any>> {
        targets = parsed
        evaluate()
        state()
      }
      .get(PROBE_TIMEOUT_MS * (parsed.size + 2).toLong(), TimeUnit.MILLISECONDS)
  }

  /** `wifiWithoutInternet`: the phone is on a Wi-Fi without internet; `bound`: the app uses it. */
  fun state(): Map<String, Any> =
    mapOf("wifiWithoutInternet" to (wifi != null && !validated), "bound" to (bound != null))

  /** On the worker thread: binds the app to the Wi-Fi or lets go, and says so when it changed. */
  private fun evaluate() {
    val manager = connectivity ?: return
    val network = wifi
    val wanted =
      when {
        network == null -> null
        // With internet the Wi-Fi is Android's default network already.
        validated -> null
        // Nothing known yet: stay on the Wi-Fi so the PC can be looked for there.
        targets.isEmpty() -> network
        targets.any { reachable(network, it) } -> network
        else -> null
      }
    val before = state()
    if (wanted != bound) {
      try {
        manager.bindProcessToNetwork(wanted)
        bound = wanted
      } catch (e: RuntimeException) {
        bound = null
      }
    }
    val after = state()
    if (after != before) listener?.invoke(after)
  }

  /** Whether the PC accepts a TCP connection at `target` through `network`. */
  private fun reachable(network: Network, target: Pair<String, Int>): Boolean =
    try {
      val address = network.getAllByName(target.first).firstOrNull()
      if (address == null) {
        false
      } else {
        network.socketFactory.createSocket().use {
          it.connect(InetSocketAddress(address, target.second), PROBE_TIMEOUT_MS)
        }
        true
      }
    } catch (e: Exception) {
      false
    }

  private fun targetOf(serverUrl: String): Pair<String, Int>? {
    val uri = Uri.parse(serverUrl)
    val host = uri.host?.removePrefix("[")?.removeSuffix("]") ?: return null
    if (host.isEmpty()) return null
    val port =
      when {
        uri.port > 0 -> uri.port
        uri.scheme == "http" -> 80
        else -> 443
      }
    return host to port
  }
}
