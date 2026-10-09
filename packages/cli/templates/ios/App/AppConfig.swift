import Foundation

enum AppConfig {
    /// The URL the app opens on launch. In the iOS simulator, `localhost`
    /// reaches the Mac, so a local dev server works as is.
    static let baseURL = URL(string: "__BASE_URL__")!
}
