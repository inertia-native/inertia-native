package dev.inertianative.app

/**
 * Where the app points. Change the server in app/build.gradle.kts (BASE_URL).
 *
 * In the emulator (or on a phone), `localhost` is the device itself.
 * `npx inertia-native run android` runs `adb reverse` for the server's port
 * (and the Vite dev server's), so `localhost` reaches your machine. Starting
 * from Android Studio instead? Run `adb reverse tcp:PORT tcp:PORT` once per
 * emulator boot, or point BASE_URL at http://10.0.2.2:PORT.
 */
object Urls {
    val base: String = BuildConfig.BASE_URL

    val pathConfiguration: String =
        "$base/inertia-native/path-configuration/android_v1.json"
}
