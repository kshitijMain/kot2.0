package com.rp.mobilenative

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address
import java.net.InetAddress
import java.util.ArrayDeque

/**
 * Finding the restaurant PC on the Wi-Fi by mDNS / DNS-SD (P9-27, AUTH-007): the PC announces
 * `_parossa-pos._tcp` with TXT records `v`, `tls` and `ca`. JavaScript filters the answers by the
 * CA it trusts and checks the certificate itself; this only lists who answered.
 */
class RpLanDiscoveryModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RpLanDiscovery")

    /**
     * Browses `serviceType` (e.g. `_parossa-pos._tcp`) for up to `timeoutMs` and resolves the PCs
     * that answered: `[{ name, host, port, txt }]`, `host` an IPv4 address. It stops early once
     * answers have settled; an empty list when there is no Wi-Fi or nothing answers.
     */
    AsyncFunction("discover") { serviceType: String, timeoutMs: Int, promise: Promise ->
      LanDiscoveryRun(context(), serviceType, timeoutMs.toLong().coerceIn(500L, 15_000L), promise)
        .start()
    }
  }

  private fun context(): Context =
    appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
}

/**
 * One discovery: `NsdManager` browses while a Wi-Fi multicast lock is held (many phones drop
 * multicast without it), resolves each service found one at a time (older Android resolves only
 * one at once), and gives up after the timeout. Every step runs on the main thread's handler.
 */
private class LanDiscoveryRun(
  context: Context,
  private val serviceType: String,
  private val timeoutMs: Long,
  private val promise: Promise,
) {
  private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
  private val multicast: WifiManager.MulticastLock? =
    (context.getSystemService(Context.WIFI_SERVICE) as? WifiManager)
      ?.createMulticastLock("rp-lan-discovery")
      ?.apply { setReferenceCounted(false) }
  private val handler = Handler(Looper.getMainLooper())
  private val found = LinkedHashMap<String, Map<String, Any>>()
  private val pending = ArrayDeque<NsdServiceInfo>()
  private var resolving = false
  private var discovering = false
  private var finished = false

  private val settled = Runnable { if (!resolving && pending.isEmpty()) finish() }

  private val listener =
    object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(serviceType: String) = Unit

      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
        handler.post {
          discovering = false
          finish()
        }
      }

      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit

      override fun onDiscoveryStopped(serviceType: String) = Unit

      override fun onServiceFound(service: NsdServiceInfo) {
        handler.post { enqueue(service) }
      }

      override fun onServiceLost(service: NsdServiceInfo) = Unit
    }

  fun start() {
    handler.post {
      try {
        multicast?.acquire()
      } catch (e: SecurityException) {
        // Without the lock some phones miss answers; discovery still tries.
      }
      try {
        nsd.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
        discovering = true
      } catch (e: Exception) {
        finish()
        return@post
      }
      handler.postDelayed({ finish() }, timeoutMs)
    }
  }

  private fun enqueue(service: NsdServiceInfo) {
    if (finished) return
    handler.removeCallbacks(settled)
    pending.add(service)
    resolveNext()
  }

  @Suppress("DEPRECATION")
  private fun resolveNext() {
    if (resolving || finished) return
    val next = pending.poll()
    if (next == null) {
      // Answers have settled: no need to wait for the whole timeout once a PC is known.
      if (found.isNotEmpty()) handler.postDelayed(settled, SETTLE_MS)
      return
    }
    resolving = true
    try {
      nsd.resolveService(
        next,
        object : NsdManager.ResolveListener {
          override fun onResolveFailed(service: NsdServiceInfo, errorCode: Int) {
            handler.post {
              resolving = false
              resolveNext()
            }
          }

          override fun onServiceResolved(service: NsdServiceInfo) {
            handler.post {
              resolving = false
              add(service)
              resolveNext()
            }
          }
        },
      )
    } catch (e: Exception) {
      resolving = false
      handler.post { resolveNext() }
    }
  }

  private fun add(service: NsdServiceInfo) {
    if (finished) return
    val host = ipv4Of(service)?.hostAddress ?: return
    val txt = HashMap<String, String>()
    for ((key, value) in service.attributes) {
      txt[key.lowercase()] = value?.toString(Charsets.UTF_8) ?: ""
    }
    found["$host:${service.port}"] =
      mapOf("name" to service.serviceName, "host" to host, "port" to service.port, "txt" to txt)
  }

  @Suppress("DEPRECATION")
  private fun ipv4Of(service: NsdServiceInfo): InetAddress? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      service.hostAddresses.firstOrNull { it is Inet4Address }?.let {
        return it
      }
    }
    return service.host as? Inet4Address
  }

  private fun finish() {
    if (finished) return
    finished = true
    handler.removeCallbacksAndMessages(null)
    if (discovering) {
      try {
        nsd.stopServiceDiscovery(listener)
      } catch (e: IllegalArgumentException) {
        // Already stopped.
      }
    }
    try {
      if (multicast?.isHeld == true) multicast.release()
    } catch (e: RuntimeException) {
      // Released already.
    }
    promise.resolve(found.values.toList())
  }

  private companion object {
    /** How long after the last answer discovery waits for another PC before it stops. */
    const val SETTLE_MS = 600L
  }
}
