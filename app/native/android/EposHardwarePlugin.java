package uk.co.ricos.epos;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.sunmi.peripheral.printer.InnerPrinterCallback;
import com.sunmi.peripheral.printer.InnerPrinterManager;
import com.sunmi.peripheral.printer.SunmiPrinterService;

/**
 * EposHardware — native bridge for the Sunmi T2 (Java; the Capacitor Android
 * project is Java by default, so no Kotlin Gradle plugin is needed).
 *
 * JS side (app/web/plugins/epos-hardware.js → window.EposHardware) calls:
 *   - printReceipt({ text })   print a plain-text/ESC-POS receipt on the built-in printer
 *   - kickDrawer()             pop the cash drawer off the printer's RJ11 port
 *   - collectCardPayment({…})  Stripe Terminal (Phase 3 — still a stub here)
 *
 * Printer + drawer use Sunmi's inner-printer (woyou) service via
 * com.sunmi:printerlibrary (Maven Central). The plugin binds in load() and
 * degrades to { ok:false } on a non-Sunmi device, so it's safe anywhere — the
 * printer/drawer only do something on the T2. Auto-injected into the generated
 * android project by app/scripts/inject-native.mjs. Can't be compiled/tested in
 * the cloud sandbox — smoke-test on the device.
 */
@CapacitorPlugin(name = "EposHardware")
public class EposHardwarePlugin extends Plugin {

    // Set once the woyou service connects; null on a non-Sunmi device or before bind.
    private SunmiPrinterService printer = null;

    private final InnerPrinterCallback printerCallback = new InnerPrinterCallback() {
        @Override
        protected void onConnected(SunmiPrinterService service) { printer = service; }
        @Override
        protected void onDisconnected() { printer = null; }
    };

    @Override
    public void load() {
        // On a non-Sunmi device this throws (no such service); swallow it so the
        // plugin degrades to { ok:false } instead of crashing the app.
        try {
            InnerPrinterManager.getInstance().bindService(getContext(), printerCallback);
        } catch (Exception e) {
            printer = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        try {
            InnerPrinterManager.getInstance().unBindService(getContext(), printerCallback);
        } catch (Exception e) { /* ignore */ }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void printReceipt(PluginCall call) {
        String text = call.getString("text", "");
        SunmiPrinterService svc = printer;
        if (svc == null) { resolveNotWired(call, "printer-not-connected"); return; }
        try {
            svc.printText(text.endsWith("\n") ? text : text + "\n", null);
            svc.lineWrap(3, null);
            try { svc.cutPaper(null); } catch (Exception e) { /* model may have no cutter */ }
            resolveOk(call);
        } catch (Exception e) {
            resolveNotWired(call, "printer-error:" + e.getMessage());
        }
    }

    @PluginMethod
    public void kickDrawer(PluginCall call) {
        SunmiPrinterService svc = printer;
        if (svc == null) { resolveNotWired(call, "drawer-not-connected"); return; }
        try {
            // The T2's cash drawer hangs off the printer's RJ11 port. The portable way
            // to pop it is the ESC/POS "generate pulse" command via sendRAWData() —
            // works across firmware where SunmiPrinterService.openDrawer() may be absent.
            svc.sendRAWData(DRAWER_KICK, null);
            resolveOk(call);
        } catch (Exception e) {
            resolveNotWired(call, "drawer-error:" + e.getMessage());
        }
    }

    @PluginMethod
    public void collectCardPayment(PluginCall call) {
        // Phase 3 — Stripe Terminal (WisePOS E reader). See docs/PHASE3_TERMINAL.md.
        resolveNotWired(call, "terminal-not-wired");
    }

    private void resolveOk(PluginCall call) {
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    private void resolveNotWired(PluginCall call, String reason) {
        JSObject res = new JSObject();
        res.put("ok", false);
        res.put("reason", reason);
        call.resolve(res);
    }

    // ESC/POS drawer-kick: ESC p m t1 t2 -> 1B 70 00 19 FA
    // m=0 (pin 2), t1=0x19 (~50ms on), t2=0xFA (~500ms off).
    private static final byte[] DRAWER_KICK = new byte[]{ 0x1B, 0x70, 0x00, 0x19, (byte) 0xFA };
}
