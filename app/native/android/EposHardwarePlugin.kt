package uk.co.ricos.epos

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * EposHardware — native bridge for the Sunmi T2.
 *
 * JS side (app/web/plugins/epos-hardware.js) calls:
 *   - printReceipt({ text })            print an 80mm receipt on the built-in printer
 *   - kickDrawer()                      open the cash drawer (24V port)
 *   - collectCardPayment({ amountP, currency, orderDraft })  Tap-to-Pay (Stripe Terminal)
 *
 * This is a SCAFFOLD: each method resolves { ok:false, reason } until the SDKs
 * are wired. See app/native/android/README.md for: where to copy this file,
 * how to register it in MainActivity, and the Gradle deps to add.
 *
 * TODO(printer/drawer): bind Sunmi's printer service (woyou AIDL
 *   InnerPrinterService / SunmiPrinterService) and replace the stubs.
 * TODO(card): integrate the Stripe Terminal Android SDK + Tap to Pay on Android.
 *   The PaymentIntent is always created server-side; mint a connection token
 *   from a Phase-3 endpoint (e.g. POST /api/staff/terminal/connection-token,
 *   scoped to the shop's Stripe connected account), collect + process here, and
 *   resolve { ok:true, paymentIntentId, last4 } so the Sale flow can submit a
 *   counter_card order.
 */
@CapacitorPlugin(name = "EposHardware")
class EposHardwarePlugin : Plugin() {

    @PluginMethod
    fun printReceipt(call: PluginCall) {
        val text = call.getString("text") ?: ""
        // TODO: SunmiPrinterService.printText(text); .lineWrap(3); .cutPaper()
        resolveNotWired(call, "printer-not-wired")
    }

    @PluginMethod
    fun kickDrawer(call: PluginCall) {
        // TODO: SunmiPrinterService.openDrawer()  (or pulse the 24V drawer port)
        resolveNotWired(call, "drawer-not-wired")
    }

    @PluginMethod
    fun collectCardPayment(call: PluginCall) {
        // TODO: Stripe Terminal Tap to Pay on Android.
        //   1) GET connection token from backend
        //   2) initialise Terminal + discover the Tap-to-Pay reader
        //   3) retrievePaymentIntent(clientSecret) -> collectPaymentMethod -> confirmPaymentIntent
        //   4) call.resolve({ ok:true, paymentIntentId, last4 })
        resolveNotWired(call, "terminal-not-wired")
    }

    private fun resolveNotWired(call: PluginCall, reason: String) {
        val res = JSObject()
        res.put("ok", false)
        res.put("reason", reason)
        call.resolve(res)
    }
}
