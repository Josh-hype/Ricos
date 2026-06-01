package uk.co.ricos.epos

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.sunmi.peripheral.printer.InnerPrinterCallback
import com.sunmi.peripheral.printer.InnerPrinterManager
import com.sunmi.peripheral.printer.SunmiPrinterService

/**
 * EposHardware — native bridge for the Sunmi T2.
 *
 * JS side (app/web/plugins/epos-hardware.js) calls:
 *   - printReceipt({ text })            print an 80mm receipt on the built-in printer
 *   - kickDrawer()                      pop the cash drawer (printer RJ11 port)
 *   - collectCardPayment({ amountP, currency, orderDraft })  Tap-to-Pay (Stripe Terminal)
 *
 * Printer + drawer are wired to Sunmi's inner-printer (woyou) service. Tap-to-Pay is
 * still a Phase-3 stub. Build deps + wiring: see app/native/android/README.md.
 * Requires the Sunmi printer SDK on the classpath:
 *   implementation 'com.sunmi:printerlibrary:1.0.18'   // verify the current version
 *
 * NOTE: this can't be compiled/tested in the cloud sandbox — verify the method
 * signatures against the SDK version you pin, and smoke-test on the T2.
 */
@CapacitorPlugin(name = "EposHardware")
class EposHardwarePlugin : Plugin() {

    // Set once the woyou service connects; null on a non-Sunmi device or before bind.
    private var printer: SunmiPrinterService? = null

    private val printerCallback = object : InnerPrinterCallback() {
        override fun onConnected(service: SunmiPrinterService) { printer = service }
        override fun onDisconnected() { printer = null }
    }

    override fun load() {
        // Bind the printer service. On a non-Sunmi device this throws (no such service);
        // we swallow it so the plugin degrades to { ok:false } instead of crashing.
        try {
            InnerPrinterManager.getInstance().bindService(context, printerCallback)
        } catch (e: Exception) {
            printer = null
        }
    }

    override fun handleOnDestroy() {
        try { InnerPrinterManager.getInstance().unBindService(context, printerCallback) } catch (e: Exception) {}
        super.handleOnDestroy()
    }

    @PluginMethod
    fun printReceipt(call: PluginCall) {
        val text = call.getString("text") ?: ""
        val svc = printer ?: return resolveNotWired(call, "printer-not-connected")
        try {
            svc.printText(if (text.endsWith("\n")) text else text + "\n", null)
            svc.lineWrap(3, null)
            try { svc.cutPaper(null) } catch (e: Exception) { /* model may have no cutter */ }
            resolveOk(call)
        } catch (e: Exception) {
            resolveNotWired(call, "printer-error:${e.message}")
        }
    }

    @PluginMethod
    fun kickDrawer(call: PluginCall) {
        val svc = printer ?: return resolveNotWired(call, "drawer-not-connected")
        try {
            // The T2's cash drawer hangs off the printer's RJ11 port. The portable way to
            // pop it is the ESC/POS "generate pulse" command sent via sendRAWData() — this
            // works across Sunmi firmware where SunmiPrinterService.openDrawer() may be
            // absent. (openDrawer()/getDrawerStatus() exist on newer service versions.)
            svc.sendRAWData(DRAWER_KICK, null)
            resolveOk(call)
        } catch (e: Exception) {
            resolveNotWired(call, "drawer-error:${e.message}")
        }
    }

    @PluginMethod
    fun collectCardPayment(call: PluginCall) {
        // Phase 3 — Stripe Terminal / Tap to Pay on Android. See docs/PHASE3_TERMINAL.md.
        //   1) GET a connection token from POST /api/staff/terminal/connection-token
        //   2) initialise Terminal + discover the reader (Tap-to-Pay or WisePOS E)
        //   3) retrievePaymentIntent(clientSecret) -> collectPaymentMethod -> confirmPaymentIntent
        //   4) call.resolve({ ok:true, paymentIntentId, last4 }) so the Sale flow can
        //      submit a counter_card order that the server marks paid only on capture.
        resolveNotWired(call, "terminal-not-wired")
    }

    private fun resolveOk(call: PluginCall) {
        val res = JSObject()
        res.put("ok", true)
        call.resolve(res)
    }

    private fun resolveNotWired(call: PluginCall, reason: String) {
        val res = JSObject()
        res.put("ok", false)
        res.put("reason", reason)
        call.resolve(res)
    }

    companion object {
        // ESC/POS drawer-kick: ESC p m t1 t2  ->  1B 70 00 19 FA
        // m=0 (pin 2), t1=0x19 (~50ms on), t2=0xFA (~500ms off).
        private val DRAWER_KICK = byteArrayOf(0x1B, 0x70, 0x00, 0x19, 0xFA.toByte())
    }
}
