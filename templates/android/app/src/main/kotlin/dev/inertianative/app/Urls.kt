package dev.inertianative.app

/**
 * Where the app points. Change the server in app/build.gradle.kts (BASE_URL).
 */
object Urls {
    val base: String =
        if (BuildConfig.DEBUG) reachableFromEmulator(BuildConfig.BASE_URL) else BuildConfig.BASE_URL

    val pathConfiguration: String =
        "$base/inertia-native/path-configuration/android_v1.json"
}

private val localhost = Regex("""^(https?://)(?:localhost|127\.0\.0\.1)(?=[:/]|$)""")

// Inside the emulator, localhost is the emulator itself; 10.0.2.2 is your
// machine. If you test on a phone with `adb reverse`, drop this rewrite.
private fun reachableFromEmulator(url: String): String =
    localhost.replace(url) { it.groupValues[1] + "10.0.2.2" }
