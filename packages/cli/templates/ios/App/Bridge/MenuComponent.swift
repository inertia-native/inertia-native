// From the Hotwire Native iOS demo app. Copyright (c) 2024 Hotwire, MIT License:
// https://github.com/hotwired/hotwire-native-ios/blob/main/LICENSE

import Foundation
import HotwireNative
import UIKit
import WebKit

/// Bridge component to display a native bottom sheet menu,
/// which will send the selected index of the tapped menu item back to the web.
final class MenuComponent: BridgeComponent {
    override nonisolated class var name: String { "menu" }

    override func onReceive(message: Message) {
        guard let event = Event(rawValue: message.event) else {
            return
        }

        switch event {
        case .display:
            handleDisplayEvent(message: message)
        }
    }

    // MARK: Private

    private var viewController: UIViewController? {
        delegate?.destination as? UIViewController
    }

    private func handleDisplayEvent(message: Message) {
        guard let data: MessageData = message.data() else { return }
        showAlertSheet(with: data.title, items: data.items, source: data.source)
    }

    private func showAlertSheet(with title: String, items: [Item], source: Source?) {
        let alertController = UIAlertController(
            title: title,
            message: nil,
            preferredStyle: .actionSheet
        )

        for item in items {
            let action = UIAlertAction(title: item.title, style: .default) { [unowned self] _ in
                onItemSelected(item: item)
            }
            alertController.addAction(action)
        }

        let cancelAction = UIAlertAction(title: "Cancel", style: .cancel)
        alertController.addAction(cancelAction)

        // Set popoverController for devices that support them (iPad, iOS 26+)
        if let popoverController = alertController.popoverPresentationController {
            popoverController.sourceView = viewController?.view

            if let source, let webView = (viewController as? Visitable)?.visitableView.webView {
                // The source coordinates come from the web page, relative to the
                // web view's viewport. The web view's scroll view has content
                // insets for the navigation bar, so account for the top inset.
                let contentInsetTop = webView.scrollView.adjustedContentInset.top
                popoverController.sourceRect = CGRect(
                    x: source.x, y: source.y + Double(contentInsetTop), width: source.width, height: source.height
                )
            } else {
                popoverController.sourceRect = viewController?.view.bounds ?? .zero
                popoverController.permittedArrowDirections = []
            }
        }

        viewController?.present(alertController, animated: true)
    }

    private func onItemSelected(item: Item) {
        reply(
            to: Event.display.rawValue,
            with: SelectionMessageData(selectedIndex: item.index)
        )
    }
}

// MARK: Events

private extension MenuComponent {
    enum Event: String {
        case display
    }
}

// MARK: Message data

private extension MenuComponent {
    struct MessageData: Decodable {
        let title: String
        let items: [Item]
        /// The tapped element's frame (`getBoundingClientRect()`), for the
        /// popover to point at. Without it the menu shows centered.
        let source: Source?
    }

    struct Source: Decodable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }

    struct Item: Decodable {
        let title: String
        let index: Int
    }

    struct SelectionMessageData: Encodable {
        let selectedIndex: Int
    }
}
