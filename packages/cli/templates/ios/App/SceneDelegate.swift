import HotwireNative
import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    private lazy var navigator = Navigator(
        configuration: .init(name: "main", startLocation: AppConfig.baseURL),
        delegate: self
    )

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = navigator.rootViewController
        window?.makeKeyAndVisible()

        navigator.start()
    }
}

extension SceneDelegate: NavigatorDelegate {
    func handle(proposal: VisitProposal, from navigator: Navigator) -> ProposalResult {
        // To show a native screen instead of a web page, give a path
        // configuration rule a `view_controller` and return
        // `.acceptCustom(yourViewController)` when `proposal.viewController`
        // matches it.
        .accept
    }

    func visitableDidFailRequest(_ visitable: any Visitable, error: HotwireNativeError, retryHandler: RetryBlock?) {
        // Handle specific failures here, e.g. route to your sign-in page when
        // `error.statusCode == 401`. Everything else gets Hotwire Native's
        // error screen with a Retry button.
        if let errorPresenter = visitable as? ErrorPresenter {
            errorPresenter.presentError(error) {
                retryHandler?()
            }
        }
    }
}
