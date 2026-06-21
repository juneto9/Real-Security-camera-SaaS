package com.securecamera.app

import android.app.*
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import java.net.InetAddress
import java.io.File

class ScanService : Service() {

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var isRunning = false

    companion object {
        const val CHANNEL_ID      = "rsc_scan_channel"
        const val NOTIFICATION_ID = 1001
        const val ACTION_START    = "RSC_SCAN_START"
        const val ACTION_STOP     = "RSC_SCAN_STOP"
        var onDevicesFound: ((List<Map<String, String?>>) -> Unit)? = null
        var onProgress: ((String) -> Unit)? = null
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RSC::ScanWakeLock")
        wakeLock?.acquire(10 * 60 * 1000L)
        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "RSC::ScanWifiLock")
        wifiLock?.acquire()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                startForeground(NOTIFICATION_ID, buildNotification("Scanning your network..."))
                if (!isRunning) { isRunning = true; serviceScope.launch { runScan() } }
            }
            ACTION_STOP -> stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        serviceScope.cancel()
        try { wakeLock?.release() } catch(e: Exception) {}
        try { wifiLock?.release() } catch(e: Exception) {}
    }

    private suspend fun runScan() = withContext(Dispatchers.IO) {
        try {
            updateNotification("Reading ARP table...")
            onProgress?.invoke("Reading ARP table...")
            val initial = readArpTable()
            onProgress?.invoke("ARP: ${initial.size} devices")
            if (initial.isNotEmpty()) onDevicesFound?.invoke(initial)

            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val ipInt = wm.connectionInfo?.ipAddress ?: 0
            if (ipInt == 0) { stopSelf(); return@withContext }
            val localIp = String.format("%d.%d.%d.%d",
                ipInt and 0xff, ipInt shr 8 and 0xff,
                ipInt shr 16 and 0xff, ipInt shr 24 and 0xff)
            val base = localIp.split(".").take(3).joinToString(".")

            onProgress?.invoke("Scanning $base.0/24 in background...")
            updateNotification("Scanning $base.0/24...")

            val BATCH = 24
            for (start in 1..254 step BATCH) {
                if (!isRunning) break
                val end = minOf(start + BATCH - 1, 254)
                val jobs = (start..end).map { i ->
                    async { Pair(i, try { InetAddress.getByName("$base.$i").isReachable(600) } catch(e: Exception) { false }) }
                }
                val alive = jobs.awaitAll().filter { it.second }.map { "$base.${it.first}" }
                updateNotification("$base.$start-$end scanned")
                onProgress?.invoke("Scanned $base.$start-$end — ${alive.size} up")
                if (alive.isNotEmpty()) {
                    val arpNow = readArpTable().associateBy { it["ip"] ?: "" }
                    onDevicesFound?.invoke(alive.map { ip ->
                        mapOf("ip" to ip, "mac" to (arpNow[ip]?.get("mac") ?: ""))
                    })
                }
            }
            val final = readArpTable()
            updateNotification("Done — ${final.size} devices found")
            onProgress?.invoke("Scan complete — ${final.size} devices")
            if (final.isNotEmpty()) onDevicesFound?.invoke(final)
        } catch(e: Exception) {
            onProgress?.invoke("Scan error: ${e.message}")
        } finally {
            isRunning = false
            stopSelf()
        }
    }

    private fun readArpTable(): List<Map<String, String?>> {
        val list = mutableListOf<Map<String, String?>>()
        try {
            File("/proc/net/arp").forEachLine { line ->
                val c = line.trim().split("\\s+".toRegex())
                if (c.size >= 4 && c[0].matches(Regex("\\d+\\.\\d+\\.\\d+\\.\\d+"))) {
                    val ip = c[0]; val mac = c[3]
                    if (mac != "00:00:00:00:00:00" && !ip.endsWith(".1") && !ip.endsWith(".255"))
                        list.add(mapOf("ip" to ip, "mac" to mac))
                }
            }
        } catch(e: Exception) {}
        return list
    }

    private fun buildNotification(text: String): Notification {
        val pi = PendingIntent.getActivity(this, 0,
            Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("RSC Network Scan")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_search)
            .setOngoing(true).setContentIntent(pi).build()
    }

    private fun updateNotification(text: String) {
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "Network Scan", NotificationManager.IMPORTANCE_LOW)
                .apply { description = "RSC background network scanning" }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }
}
