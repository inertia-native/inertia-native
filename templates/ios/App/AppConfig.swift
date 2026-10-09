import Foundation

enum AppConfig {
    /// The URL the app opens on launch. In the iOS simulator, `localhost`
    /// reaches the Mac, so a local dev server works as is.
    static let baseURL = URL(string: "__BASE_URL__")!

    /// Path configuration your server can serve. When it does, it is fetched
    /// on every launch and its rules replace the bundled
    /// `path-configuration.json`.
    static let pathConfigurationURL = baseURL.appending(path: "inertia-native/path-configuration/ios_v1.json")
}
