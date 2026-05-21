// MainActivity.kt - Android app kuu
package com.zass.tracker

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.*
import okhttp3.*
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class LocationService : Service() {
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationRequest: LocationRequest
    private lateinit var locationCallback: LocationCallback
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .build()
    
    companion object {
        private const val SERVER_URL = "http://194.146.24.110:16232/api/location"
        private const val DEVICE_ID = "YOUR_UNIQUE_DEVICE_ID"
    }
    
    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(1, createNotification())
        
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        
        locationRequest = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY, 300000 // 5 minutes
        ).setMinUpdateIntervalMillis(120000) // 2 minutes
         .build()
        
        locationCallback = object : LocationCallback() {
            override fun onLocationResult(locationResult: LocationResult) {
                locationResult.lastLocation?.let { sendLocationToServer(it) }
            }
        }
    }
    
    private fun sendLocationToServer(location: Location) {
        val json = JSONObject().apply {
            put("deviceId", DEVICE_ID)
            put("lat", location.latitude)
            put("lng", location.longitude)
            put("accuracy", location.accuracy)
            put("battery", getBatteryLevel())
            put("timestamp", System.currentTimeMillis())
        }
        
        val request = Request.Builder()
            .url(SERVER_URL)
            .post(RequestBody.create(MediaType.parse("application/json"), json.toString()))
            .build()
        
        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                e.printStackTrace()
            }
            
            override fun onResponse(call: Call, response: Response) {
                response.close()
            }
        })
    }
    
    private fun getBatteryLevel(): Int {
        val batteryIntent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        return if (level != -1 && scale != -1) (level * 100 / scale) else -1
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
            == PackageManager.PERMISSION_GRANTED) {
            fusedLocationClient.requestLocationUpdates(
                locationRequest, locationCallback, Looper.getMainLooper()
            )
        }
        return START_STICKY
    }
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "location_channel",
                "Location Tracking",
                NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
    
    private fun createNotification(): Notification {
        return Notification.Builder(this, "location_channel")
            .setContentTitle("ZASS Tracker")
            .setContentText("Tracking location...")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .build()
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
}
