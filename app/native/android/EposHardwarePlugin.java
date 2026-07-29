package uk.co.ricos.epos;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.sunmi.peripheral.printer.InnerPrinterCallback;
import com.sunmi.peripheral.printer.InnerPrinterManager;
import com.sunmi.peripheral.printer.SunmiPrinterService;

// ZCS SmartPos SDK (app/native/android/libs/SmartPos_*.aar) — drives the built-in
// printer on ZCS terminals (Z90/Z91/Z92/Z93…). Verified against SmartPos 2.0.6.
import com.zcs.sdk.DriverManager;
import com.zcs.sdk.Printer;
import com.zcs.sdk.SdkResult;
import com.zcs.sdk.Sys;
import com.zcs.sdk.print.PrnStrFormat;
import com.zcs.sdk.print.PrnTextFont;
import com.zcs.sdk.print.PrnTextStyle;
import android.text.Layout;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import org.json.JSONObject;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * EposHardware — native bridge for the Sunmi T2 (Java; the Capacitor Android
 * project is Java by default, so no Kotlin Gradle plugin is needed).
 *
 * JS side (app/web/plugins/epos-hardware.js → window.EposHardware) calls:
 *   - printDoc({ ops })        rich receipt: an array of ops the web builds, rendered
 *                              with alignment / font size / bold / logo image. This is
 *                              the primary path — all layout lives in the web layer, so
 *                              the receipt design is OTA-tweakable with no rebuild.
 *   - printReceipt({ text })   plain-text fallback (older bundles / if printDoc fails)
 *   - kickDrawer()             pop the cash drawer off the printer's RJ11 port
 *   - collectCardPayment({…})  Stripe Terminal (Phase 3 — still a stub here)
 *
 * Op shapes (all fields optional unless noted):
 *   { t:"text",  s, align:"left|center|right", size:<px>, bold:bool }
 *   { t:"row",   l, r, bold:bool }              left/right columns (fixed-width font)
 *   { t:"rule" }                                 a divider line
 *   { t:"image", url }                           download + print a bitmap (e.g. the logo)
 *   { t:"feed",  n }                             blank lines
 *   { t:"cut" }                                  cut the paper
 *
 * TWO printer backends, picked at RUNTIME so one APK serves the whole fleet:
 *   Sunmi  — inner-printer (woyou) service, com.sunmi:printerlibrary (Maven Central).
 *            Binds asynchronously in load(); used by the T2 tills.
 *   ZCS    — SmartPos SDK (bundled .aar), used by the Z93 and its siblings.
 * Neither present (e.g. a plain Android tablet) ⇒ { ok:false, reason:"printer-not-connected" }
 * exactly as before, which the web layer now surfaces to staff.
 *
 * Detection is per CALL, not once at load: Sunmi binds asynchronously, so a decision
 * taken in load() would wrongly pin "no printer" on a T2 that simply hadn't bound yet.
 *
 * Auto-injected by app/scripts/inject-native.mjs. Can't be compiled/tested in the
 * cloud sandbox — smoke-test on the device.
 */
@CapacitorPlugin(name = "EposHardware")
public class EposHardwarePlugin extends Plugin {

    private SunmiPrinterService printer = null;

    // ZCS SmartPos. `zcsPrinter` stays null on non-ZCS hardware (sdkInit fails or the
    // classes aren't backed by a device), which is how we fall through to Sunmi.
    private Printer zcsPrinter = null;

    private final InnerPrinterCallback printerCallback = new InnerPrinterCallback() {
        @Override
        protected void onConnected(SunmiPrinterService service) { printer = service; }
        @Override
        protected void onDisconnected() { printer = null; }
    };

    @Override
    public void load() {
        try {
            InnerPrinterManager.getInstance().bindService(getContext(), printerCallback);
        } catch (Exception e) {
            printer = null;
        }
        initZcs();
    }

    /** Bring up the ZCS SmartPos SDK. Mirrors the vendor demo: sdkInit(), and if that
     *  fails power the board on and try once more. Wrapped in Throwable (not Exception)
     *  because on non-ZCS hardware the native layer can raise UnsatisfiedLinkError /
     *  NoClassDefFoundError, which must not take the whole plugin down. */
    private void initZcs() {
        try {
            DriverManager dm = DriverManager.getInstance();
            Sys sys = dm.getBaseSysDevice();
            int st = sys.sdkInit();
            if (st != SdkResult.SDK_OK) {
                sys.sysPowerOn();
                try { Thread.sleep(1000); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                st = sys.sdkInit();
            }
            zcsPrinter = (st == SdkResult.SDK_OK) ? dm.getPrinter() : null;
        } catch (Throwable t) {
            zcsPrinter = null;
        }
    }

    /** ZCS printer if this device has one AND it's ready. Re-inits once if the SDK
     *  came up after us (cold boot ordering), so a till isn't stuck "no printer". */
    private Printer zcs() {
        if (zcsPrinter == null) initZcs();
        return zcsPrinter;
    }

    /** Map a ZCS status code to our reason string, or null when it's good to print. */
    private String zcsFault(Printer pr) {
        try {
            int st = pr.getPrinterStatus();
            if (st == SdkResult.SDK_PRN_STATUS_PAPEROUT) return "printer-out-of-paper";
            if (st == SdkResult.SDK_PRN_STATUS_FAULT) return "printer-fault";
            if (st == SdkResult.SDK_PRN_STATUS_TOOHEAT) return "printer-overheated";
        } catch (Throwable t) {
            return "printer-status-error";
        }
        return null;
    }

    private PrnStrFormat zcsFormat(int size, String align, boolean bold) {
        PrnStrFormat f = new PrnStrFormat();
        f.setTextSize(size);
        f.setAli("center".equals(align) ? Layout.Alignment.ALIGN_CENTER
               : "right".equals(align) ? Layout.Alignment.ALIGN_OPPOSITE
               : Layout.Alignment.ALIGN_NORMAL);
        f.setStyle(bold ? PrnTextStyle.BOLD : PrnTextStyle.NORMAL);
        f.setFont(PrnTextFont.SANS_SERIF);
        return f;
    }

    @Override
    protected void handleOnDestroy() {
        try {
            InnerPrinterManager.getInstance().unBindService(getContext(), printerCallback);
        } catch (Exception e) { /* ignore */ }
        super.handleOnDestroy();
    }

    /** Rich, web-defined receipt. Every op is wrapped so a single bad op never aborts
     *  the whole print. The printer state (align/size/bold) is reset at the end. */
    @PluginMethod
    public void printDoc(PluginCall call) {
        JSArray ops = call.getArray("ops");
        if (ops == null) { resolveNotWired(call, "no-ops"); return; }
        Printer zp = zcs();
        if (zp != null) { printDocZcs(call, zp, ops); return; }
        SunmiPrinterService svc = printer;
        if (svc == null) { resolveNotWired(call, "printer-not-connected"); return; }
        try {
            for (int i = 0; i < ops.length(); i++) {
                JSONObject op;
                try { op = ops.getJSONObject(i); } catch (Exception e) { continue; }
                String t = op.optString("t", "text");
                try {
                    if ("image".equals(t)) {
                        Bitmap bmp = downloadBitmap(op.optString("url", ""));
                        if (bmp != null) { svc.setAlignment(1, null); svc.printBitmap(bmp, null); svc.lineWrap(1, null); }
                    } else if ("rule".equals(t)) {
                        svc.setAlignment(0, null); svc.setFontSize(24f, null); setBold(svc, false);
                        svc.printText("--------------------------------\n", null);
                    } else if ("feed".equals(t)) {
                        svc.lineWrap(op.optInt("n", 1), null);
                    } else if ("cut".equals(t)) {
                        try { svc.cutPaper(null); } catch (Exception e) { /* no cutter */ }
                    } else if ("row".equals(t)) {
                        svc.setAlignment(0, null); svc.setFontSize(24f, null);
                        setBold(svc, op.optBoolean("bold", false));
                        svc.printText(rowText(op.optString("l", ""), op.optString("r", "")) + "\n", null);
                        setBold(svc, false);
                    } else { // text
                        String align = op.optString("align", "left");
                        svc.setAlignment("center".equals(align) ? 1 : ("right".equals(align) ? 2 : 0), null);
                        svc.setFontSize((float) op.optDouble("size", 24), null);
                        setBold(svc, op.optBoolean("bold", false));
                        svc.printText(op.optString("s", "") + "\n", null);
                        setBold(svc, false);
                    }
                } catch (Exception e) { /* skip a bad op, keep going */ }
            }
            try { svc.setAlignment(0, null); svc.setFontSize(24f, null); setBold(svc, false); } catch (Exception e) {}
            resolveOk(call);
        } catch (Exception e) {
            resolveNotWired(call, "print-error:" + e.getMessage());
        }
    }

    @PluginMethod
    public void printReceipt(PluginCall call) {
        String text = call.getString("text", "");
        Printer zp = zcs();
        if (zp != null) { printTextZcs(call, zp, text); return; }
        SunmiPrinterService svc = printer;
        if (svc == null) { resolveNotWired(call, "printer-not-connected"); return; }
        try {
            svc.setAlignment(0, null); svc.setFontSize(24f, null);
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

    // ── ZCS SmartPos rendering ───────────────────────────────────────────────────
    /** Same op vocabulary as the Sunmi path, so the receipt design stays entirely in
     *  the web layer and remains OTA-tweakable on both hardware families.
     *  ZCS buffers the whole document then commits it with setPrintStart(). */
    private void printDocZcs(PluginCall call, Printer pr, JSArray ops) {
        String fault = zcsFault(pr);
        if (fault != null) { resolveNotWired(call, fault); return; }
        try {
            for (int i = 0; i < ops.length(); i++) {
                JSONObject op;
                try { op = ops.getJSONObject(i); } catch (Exception e) { continue; }
                String t = op.optString("t", "text");
                try {
                    if ("image".equals(t)) {
                        Bitmap bmp = downloadBitmap(op.optString("url", ""));
                        if (bmp != null) pr.setPrintAppendBitmap(bmp, Layout.Alignment.ALIGN_CENTER);
                    } else if ("rule".equals(t)) {
                        pr.setPrintAppendString("--------------------------------", zcsFormat(24, "left", false));
                    } else if ("feed".equals(t)) {
                        int n = op.optInt("n", 1);
                        for (int k = 0; k < n; k++) pr.setPrintAppendString(" ", zcsFormat(24, "left", false));
                    } else if ("cut".equals(t)) {
                        // The Z93 has no cutter — feed instead so the ticket clears the head.
                        pr.setPrintAppendString(" ", zcsFormat(24, "left", false));
                    } else if ("row".equals(t)) {
                        pr.setPrintAppendString(rowText(op.optString("l", ""), op.optString("r", "")),
                                                zcsFormat(24, "left", op.optBoolean("bold", false)));
                    } else { // text
                        pr.setPrintAppendString(op.optString("s", ""),
                                                zcsFormat((int) op.optDouble("size", 24),
                                                          op.optString("align", "left"),
                                                          op.optBoolean("bold", false)));
                    }
                } catch (Exception e) { /* skip a bad op, keep going */ }
            }
            int st = pr.setPrintStart();
            if (st == SdkResult.SDK_OK) resolveOk(call);
            else resolveNotWired(call, "print-failed:" + st);
        } catch (Throwable t) {
            resolveNotWired(call, "print-error:" + t.getMessage());
        }
    }

    private void printTextZcs(PluginCall call, Printer pr, String text) {
        String fault = zcsFault(pr);
        if (fault != null) { resolveNotWired(call, fault); return; }
        try {
            PrnStrFormat f = zcsFormat(24, "left", false);
            for (String line : (text == null ? "" : text).split("\\n", -1)) {
                pr.setPrintAppendString(line.isEmpty() ? " " : line, f);
            }
            pr.setPrintAppendString(" ", f);
            pr.setPrintAppendString(" ", f);
            int st = pr.setPrintStart();
            if (st == SdkResult.SDK_OK) resolveOk(call);
            else resolveNotWired(call, "print-failed:" + st);
        } catch (Throwable t) {
            resolveNotWired(call, "printer-error:" + t.getMessage());
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────────
    private void setBold(SunmiPrinterService svc, boolean on) {
        // ESC E n — standard ESC/POS emphasis; composes with the Sunmi font calls.
        try { svc.sendRAWData(on ? BOLD_ON : BOLD_OFF, null); } catch (Exception e) {}
    }

    private String rowText(String l, String r) {
        final int W = 32; // default font ≈ 32 cols on the 58mm head
        if (l == null) l = "";
        if (r == null) r = "";
        int gap = W - l.length() - r.length();
        if (gap < 1) return l + " " + r;
        StringBuilder sb = new StringBuilder(l);
        for (int i = 0; i < gap; i++) sb.append(' ');
        return sb.append(r).toString();
    }

    private Bitmap downloadBitmap(String urlStr) {
        if (urlStr == null || urlStr.isEmpty()) return null;
        HttpURLConnection conn = null;
        try {
            URL u = new URL(urlStr);
            conn = (HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.connect();
            InputStream is = conn.getInputStream();
            Bitmap bmp = BitmapFactory.decodeStream(is);
            is.close();
            if (bmp == null) return null;
            int target = 360; // fit the 58mm head; printBitmap dithers to mono
            if (bmp.getWidth() > target) {
                int h = Math.round(bmp.getHeight() * (target / (float) bmp.getWidth()));
                bmp = Bitmap.createScaledBitmap(bmp, target, h, true);
            }
            return bmp;
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
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
    private static final byte[] DRAWER_KICK = new byte[]{ 0x1B, 0x70, 0x00, 0x19, (byte) 0xFA };
    private static final byte[] BOLD_ON = new byte[]{ 0x1B, 0x45, 0x01 };
    private static final byte[] BOLD_OFF = new byte[]{ 0x1B, 0x45, 0x00 };
}
