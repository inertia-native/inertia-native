plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.serialization)
}

android {
    // The Kotlin package stays fixed. Your app's identity is `applicationId`.
    namespace = "dev.inertianative.app"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "__BUNDLE_ID__"
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        // The server the app loads. For localhost, see Urls.kt.
        buildConfigField("String", "BASE_URL", "\"__BASE_URL__\"")
    }

    buildTypes {
        release {
            optimization {
                enable = false
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
        viewBinding = true
    }
}

dependencies {
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.androidx.core.ktx)
    implementation(libs.material)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.hotwire.core)
    implementation(libs.hotwire.navigation.fragments)
}
