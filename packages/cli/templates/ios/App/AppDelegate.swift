import HotwireNative
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureHotwire()
        return true
    }

    // MARK: UISceneSession Lifecycle

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }

    private func configureHotwire() {
        // To change navigation without a release, serve a copy of this file
        // and add `.server(AppConfig.baseURL.appending(path: "..."))`: it
        // replaces the bundled rules once downloaded, on every launch.
        Hotwire.loadPathConfiguration(from: [
            .file(Bundle.main.url(forResource: "path-configuration", withExtension: "json")!),
        ])

        // Native halves of the bridge components. Each one only does
        // something once a page sends it a message.
        Hotwire.registerBridgeComponents([
            AlertComponent.self,
            ButtonComponent.self,
            FormComponent.self,
            MenuComponent.self,
            OverflowMenuComponent.self,
        ])

        Hotwire.config.backButtonDisplayMode = .minimal
        Hotwire.config.showDoneButtonOnModals = true

        #if DEBUG
        Hotwire.config.debugLoggingEnabled = true
        #endif
    }
}
