package dev.inertianative.app

import android.app.Application
import dev.hotwire.core.bridge.BridgeComponentFactory
import dev.hotwire.core.bridge.KotlinXJsonConverter
import dev.hotwire.core.config.Hotwire
import dev.hotwire.core.logging.HotwireLogLevel
import dev.hotwire.core.turbo.config.PathConfiguration
import dev.hotwire.navigation.config.defaultFragmentDestination
import dev.hotwire.navigation.config.registerBridgeComponents
import dev.hotwire.navigation.config.registerFragmentDestinations
import dev.inertianative.app.bridge.AlertComponent
import dev.inertianative.app.bridge.ButtonComponent
import dev.inertianative.app.bridge.FormComponent
import dev.inertianative.app.bridge.MenuComponent
import dev.inertianative.app.bridge.OverflowMenuComponent

class MainApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        Hotwire.defaultFragmentDestination = WebFragment::class
        Hotwire.registerFragmentDestinations(WebFragment::class)

        Hotwire.registerBridgeComponents(
            BridgeComponentFactory("alert", ::AlertComponent),
            BridgeComponentFactory("button", ::ButtonComponent),
            BridgeComponentFactory("form", ::FormComponent),
            BridgeComponentFactory("menu", ::MenuComponent),
            BridgeComponentFactory("overflow-menu", ::OverflowMenuComponent)
        )

        Hotwire.config.jsonConverter = KotlinXJsonConverter()
        Hotwire.config.webViewDebuggingEnabled = BuildConfig.DEBUG
        if (BuildConfig.DEBUG) {
            Hotwire.config.logger.logLevel = HotwireLogLevel.DEBUG
        }

        // The bundled file applies right away; the server's copy replaces it
        // once downloaded, so you can change navigation without a release.
        Hotwire.loadPathConfiguration(
            context = this,
            location = PathConfiguration.Location(
                assetFilePath = "json/path-configuration.json",
                remoteFileUrl = Urls.pathConfiguration
            )
        )
    }
}
