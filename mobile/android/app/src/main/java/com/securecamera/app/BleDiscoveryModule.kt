package com.securecamera.app

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * BleDiscoveryModule — RSC BLE Scanner
 *
 * Runs BLE advertisement scan alongside existing ARP/IP scan in the
 * same foreground service context. Posts results to VPS /api/cameras/ble-discovered.
 *
 * Fallback: if phone goes offline, VPS serves last-known BLE table from DB
 * (ble_last_seen timestamp) so Discover tab degrades gracefully — never blank.
 */
class BleDiscoveryModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "BleDiscoveryModule"

    private var scanCallback: ScanCallback? = null
    private val handler = Handler(Looper.getMainLooper())
    private val discovered = mutableMapOf<String, WritableMap>()

    companion object {
        const val BLE_SCAN_DURATION_MS = 12_000L  // 12 second scan window
        const val EVENT_BLE_DEVICE    = "bleDeviceFound"
        const val EVENT_BLE_DONE      = "bleScanComplete"
        const val EVENT_BLE_PROGRESS  = "bleProgress"
    }

    @ReactMethod
    fun startBleScan(promise: Promise) {
        try {
            val btManager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val btAdapter = btManager?.adapter
            if (btAdapter == null || !btAdapter.isEnabled) {
                emitEvent(EVENT_BLE_PROGRESS, "Bluetooth not available — BLE scan skipped")
                promise.resolve("bt_unavailable")
                return
            }

            val scanner = btAdapter.bluetoothLeScanner
            if (scanner == null) {
                promise.resolve("scanner_unavailable")
                return
            }

            discovered.clear()
            emitEvent(EVENT_BLE_PROGRESS, "BLE scan started...")

            val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build()

            val callback = object : ScanCallback() {
                override fun onScanResult(callbackType: Int, result: ScanResult) {
                    processScanResult(result)
                }
                override fun onBatchScanResults(results: List<ScanResult>) {
                    results.forEach { processScanResult(it) }
                }
                override fun onScanFailed(errorCode: Int) {
                    emitEvent(EVENT_BLE_PROGRESS, "BLE scan error: $errorCode")
                    promise.resolve("scan_failed_$errorCode")
                }
            }
            scanCallback = callback

            scanner.startScan(emptyList<ScanFilter>(), settings, callback)

            // Auto-stop after scan window and emit results
            handler.postDelayed({
                stopBleScanInternal(scanner)
                val arr = Arguments.createArray()
                discovered.values.forEach { arr.pushMap(it) }
                emitEvent(EVENT_BLE_DONE, arr)
                emitEvent(EVENT_BLE_PROGRESS, "BLE scan complete — ${discovered.size} devices")
                promise.resolve("complete_${discovered.size}")
            }, BLE_SCAN_DURATION_MS)

        } catch (e: SecurityException) {
            // Missing BLUETOOTH_SCAN permission — skip gracefully
            emitEvent(EVENT_BLE_PROGRESS, "BLE permission denied — scan skipped")
            promise.resolve("permission_denied")
        } catch (e: Exception) {
            promise.reject("ERR_BLE", e.message)
        }
    }

    @ReactMethod
    fun stopBleScan(promise: Promise) {
        try {
            val btManager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val scanner = btManager?.adapter?.bluetoothLeScanner
            if (scanner != null) stopBleScanInternal(scanner)
            promise.resolve("stopped")
        } catch (e: Exception) { promise.resolve("stopped") }
    }

    private fun stopBleScanInternal(scanner: android.bluetooth.le.BluetoothLeScanner) {
        try {
            scanCallback?.let { scanner.stopScan(it) }
            scanCallback = null
        } catch (e: Exception) {}
    }

    private fun processScanResult(result: ScanResult) {
        try {
            val device = result.device
            val mac = device.address ?: return
            if (discovered.containsKey(mac)) return  // deduplicate

            val record = result.scanRecord
            val deviceName = record?.deviceName
                ?: (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
                        try { device.name } catch(e: SecurityException) { null }
                    else null)

            // Extract manufacturer ID from advertisement data (bytes 0-1, little-endian)
            var manufacturerId: String? = null
            record?.manufacturerSpecificData?.let { sparse ->
                if (sparse.size() > 0) {
                    val companyId = sparse.keyAt(0)
                    manufacturerId = "0x" + companyId.toString(16).uppercase().padStart(4, '0')
                }
            }

            // Extract service UUIDs
            val serviceUuids = mutableListOf<String>()
            record?.serviceUuids?.forEach { p ->
                serviceUuids.add(p.uuid.toString().lowercase())
            }

            val map = Arguments.createMap().apply {
                putString("mac_address", mac)
                putString("ble_name", deviceName)
                putString("manufacturer_id", manufacturerId)
                putInt("rssi", result.rssi)
                val uuidArr = Arguments.createArray()
                serviceUuids.forEach { uuidArr.pushString(it) }
                putArray("service_uuids", uuidArr)
            }
            discovered[mac] = map

            // Emit individual device as discovered
            emitEvent(EVENT_BLE_DEVICE, map)
        } catch (e: Exception) {
            // Ignore malformed advertisement packets
        }
    }

    private fun emitEvent(event: String, data: Any?) {
        try {
            if (!reactContext.hasActiveCatalystInstance()) return
            val emitter = reactContext.getJSModule(
                DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            when (data) {
                is String -> emitter.emit(event, data)
                is WritableMap -> emitter.emit(event, data)
                is WritableArray -> emitter.emit(event, data)
                else -> emitter.emit(event, data?.toString())
            }
        } catch (e: Exception) {}
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}
