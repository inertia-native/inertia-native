import Foundation
import HotwireNative
import UIKit

/// Native counterpart of the `alert` bridge component. Presents a
/// `UIAlertController` from the web side's `show` message and replies to that
/// message only when the confirming action is tapped.
///
/// Register once with `Hotwire.registerBridgeComponents([AlertComponent.self])`.
///
/// Follows joemasilotti/bridge-components (MIT).
final class AlertComponent: BridgeComponent {
    override nonisolated class var name: String { "alert" }

    override func onReceive(message: Message) {
        guard let event = Event(rawValue: message.event) else {
            return
        }

        switch event {
        case .show:
            handleShowEvent(message: message)
        }
    }

    // MARK: Private

    private var viewController: UIViewController? {
        delegate?.destination as? UIViewController
    }

    private func handleShowEvent(message: Message) {
        guard let data: MessageData = message.data() else { return }

        let alert = UIAlertController(
            title: data.title,
            message: data.description,
            preferredStyle: .alert
        )

        // Only the confirming action answers. A dismissal is silence, per the
        // contract — the web side reads "no reply" as "not confirmed".
        let confirmAction = UIAlertAction(
            title: data.confirmTitle,
            style: data.confirmActionStyle
        ) { [weak self] _ in
            self?.reply(to: message.event)
        }
        alert.addAction(confirmAction)
        alert.preferredAction = confirmAction

        alert.addAction(UIAlertAction(title: data.dismissTitle, style: .cancel))

        viewController?.present(alert, animated: true)
    }
}

// MARK: Events

private extension AlertComponent {
    enum Event: String {
        case show
    }
}

// MARK: Message data

private extension AlertComponent {
    struct MessageData: Decodable {
        let title: String
        let description: String?
        let destructive: Bool?
        let confirm: String?
        let dismiss: String?

        // The contract makes every field but `title` optional, with the default
        // supplied here rather than on the web side.
        var confirmTitle: String { confirm ?? "OK" }
        var dismissTitle: String { dismiss ?? "Cancel" }

        var confirmActionStyle: UIAlertAction.Style {
            destructive == true ? .destructive : .default
        }
    }
}
