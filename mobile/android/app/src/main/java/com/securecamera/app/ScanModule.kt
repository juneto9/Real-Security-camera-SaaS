package com.securecamera.app

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class ScanModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "ScanModule"

    @ReactMethod
    fun startScan(promise: Promise) {
        try {
            ScanService.onProgress = { msg ->
                reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("scanProgress", msg)
            }
            ScanService.onDevicesFound = { devices ->
                val arr = Arguments.createArray()
                devices.forEach { d ->
                    val map = Arguments.createMap()
                    d.forEach { (k, v) -> map.putString(k, v ?: "") }
                    arr.pushMap(map)
                }
                reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("scanDevicesFound", arr)
            }
            val intent = Intent(reactContext, ScanService::class.java).apply { action = ScanService.ACTION_START }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                reactContext.startForegroundService(intent)
            else
                reactContext.startService(intent)
            promise.resolve("started")
        } catch(e: Exception) { promise.reject("ERR_SCAN", e.message) }
    }

    @ReactMethod
    fun stopScan(promise: Promise) {
        val intent = Intent(reactContext, ScanService::class.java).apply { action = ScanService.ACTION_STOP }
        reactContext.startService(intent)
        promise.resolve("stopped")
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}
