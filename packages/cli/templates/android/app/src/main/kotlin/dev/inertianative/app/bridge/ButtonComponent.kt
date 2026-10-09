package dev.inertianative.app.bridge

import android.util.Log
import android.view.Menu
import android.view.MenuItem
import androidx.appcompat.widget.Toolbar
import androidx.fragment.app.Fragment
import dev.hotwire.core.bridge.BridgeComponent
import dev.hotwire.core.bridge.BridgeDelegate
import dev.hotwire.core.bridge.Message
import dev.inertianative.app.R
import dev.hotwire.navigation.destinations.HotwireDestination
import kotlinx.serialization.Serializable

/**
 * Native counterpart of the `button` bridge component. Adds an item to the
 * destination's toolbar from the web side's `connect` message and relays taps
 * back by replying to that same message.
 *
 * Register once with
 * `Hotwire.registerBridgeComponents(BridgeComponentFactory("button", ::ButtonComponent))`.
 *
 * The contract's `side` is not honoured: Android toolbar menu items always sit
 * at the end of the bar, so a `"left"` button still appears on the right.
 */
class ButtonComponent(
    name: String,
    private val delegate: BridgeDelegate<HotwireDestination>
) : BridgeComponent<HotwireDestination>(name, delegate) {

    private val buttonItemId = 41
    private val fragment: Fragment
        get() = delegate.destination.fragment
    private val toolbar: Toolbar?
        get() = fragment.view?.findViewById(R.id.toolbar)

    override fun onReceive(message: Message) {
        when (message.event) {
            "connect" -> handleConnectEvent(message)
            else -> Log.w("ButtonComponent", "Unknown event for message: $message")
        }
    }

    private fun handleConnectEvent(message: Message) {
        val data = message.data<MessageData>() ?: return
        showToolbarButton(data)
    }

    private fun showToolbarButton(data: MessageData) {
        val menu = toolbar?.menu ?: return
        val order = 999 // Show as the right-most button

        // Remove first, so re-connecting with a new title replaces the item
        // rather than adding a second one.
        menu.removeItem(buttonItemId)
        menu.add(Menu.NONE, buttonItemId, order, data.title).apply {
            setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
            // Per-item listener, so this does not clobber a toolbar-wide
            // listener set by another component on the same destination.
            setOnMenuItemClickListener {
                performTap()
                true
            }
        }
    }

    private fun performTap(): Boolean {
        // Reply to "connect" — the web side treats this as the tap signal.
        return replyTo("connect")
    }

    @Serializable
    data class MessageData(
        val title: String,
        val side: String? = "right"
    )
}
