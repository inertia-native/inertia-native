// Follows joemasilotti/bridge-components. Copyright (c) 2025 Joseph Masilotti,
// MIT License: https://github.com/joemasilotti/bridge-components/blob/main/LICENSE

package dev.inertianative.app.bridge

import android.util.Log
import android.util.TypedValue
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import dev.hotwire.core.bridge.BridgeComponent
import dev.hotwire.core.bridge.BridgeDelegate
import dev.hotwire.core.bridge.Message
import dev.hotwire.navigation.destinations.HotwireDestination
import kotlinx.serialization.Serializable

/**
 * Native counterpart of the `alert` bridge component. Presents an
 * `AlertDialog` from the web side's `show` message and replies to that message
 * only when the confirming action is tapped.
 *
 * Register once with
 * `Hotwire.registerBridgeComponents(BridgeComponentFactory("alert", ::AlertComponent))`.
 *
 * The contract's `destructive` is honoured as far as the platform allows:
 * Android has no destructive button style, so the confirming button is tinted
 * with the theme's error colour instead.
 */
class AlertComponent(
    name: String,
    private val delegate: BridgeDelegate<HotwireDestination>
) : BridgeComponent<HotwireDestination>(name, delegate) {

    private val fragment: Fragment
        get() = delegate.destination.fragment

    override fun onReceive(message: Message) {
        when (message.event) {
            "show" -> handleShowEvent(message)
            else -> Log.w("AlertComponent", "Unknown event for message: $message")
        }
    }

    private fun handleShowEvent(message: Message) {
        val data = message.data<MessageData>() ?: return
        val context = fragment.context ?: return

        // Only the confirming button answers. Dismissing — the dismiss button,
        // a tap outside, or the back press — is silence, per the contract.
        val dialog = AlertDialog.Builder(context)
            .setTitle(data.title)
            .setMessage(data.description)
            .setPositiveButton(data.confirm) { _, _ -> replyTo("show") }
            .setNegativeButton(data.dismiss) { dialog, _ -> dialog.dismiss() }
            .create()

        dialog.show()

        // Buttons only exist once the dialog is shown, so the tint comes after.
        if (data.destructive) {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                .setTextColor(context.errorColor())
        }
    }

    private fun android.content.Context.errorColor(): Int {
        val value = TypedValue()
        theme.resolveAttribute(com.google.android.material.R.attr.colorError, value, true)
        // A theme may hand back either a resolved colour or a reference to one.
        return if (value.resourceId != 0) ContextCompat.getColor(this, value.resourceId) else value.data
    }

    @Serializable
    data class MessageData(
        val title: String,
        val description: String? = null,
        val destructive: Boolean = false,
        val confirm: String = "OK",
        val dismiss: String = "Cancel"
    )
}
