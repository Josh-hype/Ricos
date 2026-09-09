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
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
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
    // How many times we've tried to bring the ZCS SDK up. Bounded, because the
    // retry costs a sysPowerOn + a 1s sleep: without this every print on a
    // NON-ZCS till (a Sunmi T2, say) paid that cost again and it looked like the
    // printer was hanging. Two attempts covers the cold-boot case where the SDK
    // starts just after we do; after that the answer is settled.
    private int zcsAttempts = 0;
    private static final int ZCS_MAX_ATTEMPTS = 2;

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
        if (zcsAttempts >= ZCS_MAX_ATTEMPTS) return;   // settled — don't pay the cost again
        zcsAttempts++;
        try {
            DriverManager dm = DriverManager.getInstance();
            Sys sys = dm.getBaseSysDevice();
            int st = sys.sdkInit();
            if (st != SdkResult.SDK_OK) {
                // Only worth powering the board and waiting when the SDK is actually
                // present but not ready. On hardware that has no ZCS board at all the
                // calls above throw, so we never reach this sleep.
                sys.sysPowerOn();
                try { Thread.sleep(1000); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                st = sys.sdkInit();
            }
            zcsPrinter = (st == SdkResult.SDK_OK) ? dm.getPrinter() : null;
        } catch (Throwable t) {
            // No ZCS board (UnsatisfiedLinkError / NoClassDefFoundError) — settle
            // immediately rather than retrying, so a Sunmi till never pays for this.
            zcsPrinter = null;
            zcsAttempts = ZCS_MAX_ATTEMPTS;
        }
    }

    /** ZCS printer if this device has one AND it's ready. Retries only while under
     *  ZCS_MAX_ATTEMPTS, so the cold-boot case is covered without charging every
     *  later print for a decision already made. */
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
        SunmiPrinterService svc = printer;
        if (svc == null) {
            // No Sunmi service on this device — try ZCS. Checking Sunmi FIRST matters:
            // the ZCS probe costs a sysPowerOn + 1s sleep on hardware that has no ZCS
            // board, and a Sunmi T2 would otherwise pay it on its first prints.
            Printer zp = zcs();
            if (zp != null) { printDocZcs(call, zp, ops); return; }
            resolveNotWired(call, "printer-not-connected");
            return;
        }
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
        SunmiPrinterService svc = printer;
        if (svc == null) {
            Printer zp = zcs();                       // Sunmi first — see printDoc
            if (zp != null) { printTextZcs(call, zp, text); return; }
            resolveNotWired(call, "printer-not-connected");
            return;
        }
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

    /* ====================================================================
       Caller ID — a USB modem in the till's own USB port.

       Deliberately uses Android's own USB host API rather than a serial
       library. A USB fax modem is a CDC-ACM device, which is the one class
       you can talk to with nothing but bulk transfers, and adding a Gradle
       dependency to a build that cannot be compiled or tested in the cloud
       sandbox risks the worst failure available here: an APK that will not
       build at all. Fewer moving parts wins.

       Written before the hardware was tested, so it assumes as little as
       possible:
         - finds the modem by DEVICE CLASS, not by vendor/product id
         - tries AT+VCID=1 and, if that is not accepted, AT#CID=1 — the two
           commands in the wild for switching formatted caller ID on
         - parses any "NMBR"-ish label, with or without spaces around the =
         - and when it can't do any of that, startCallerId RETURNS what it
           found: every attached device with its class and ids, plus the raw
           lines the modem sent. A blind install still tells us exactly what
           to change.
       ==================================================================== */

    private static final String ACTION_USB_PERMISSION = "uk.co.ricos.epos.USB_PERMISSION";
    private UsbDeviceConnection cidConn = null;
    private UsbInterface cidIface = null;
    private Thread cidThread = null;
    private volatile boolean cidRunning = false;
    // Last lines off the modem, kept so a failed install can still be diagnosed
    // from the till without a cable or a laptop.
    private final java.util.List<String> cidLog = new java.util.ArrayList<>();

    private void cidNote(String line) {
        synchronized (cidLog) {
            cidLog.add(line);
            while (cidLog.size() > 40) cidLog.remove(0);
        }
    }

    /** Every attached USB device, so we can see what the till sees. */
    private JSArray describeUsb(UsbManager mgr) {
        JSArray arr = new JSArray();
        try {
            for (UsbDevice d : mgr.getDeviceList().values()) {
                JSObject o = new JSObject();
                o.put("name", d.getDeviceName());
                o.put("vendorId", d.getVendorId());
                o.put("productId", d.getProductId());
                o.put("deviceClass", d.getDeviceClass());
                JSArray ifaces = new JSArray();
                for (int i = 0; i < d.getInterfaceCount(); i++) ifaces.put(d.getInterface(i).getInterfaceClass());
                o.put("interfaceClasses", ifaces);
                arr.put(o);
            }
        } catch (Throwable t) { /* reported as an empty list */ }
        return arr;
    }

    /** A CDC device: interface class 2 (comm) or 10 (cdc-data). */
    private static boolean looksLikeModem(UsbDevice d) {
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            int c = d.getInterface(i).getInterfaceClass();
            if (c == UsbConstants.USB_CLASS_COMM || c == UsbConstants.USB_CLASS_CDC_DATA) return true;
        }
        return false;
    }

    @PluginMethod
    public void startCallerId(PluginCall call) {
        JSObject res = new JSObject();
        try {
            UsbManager mgr = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
            if (mgr == null) { res.put("ok", false); res.put("reason", "no-usb-service"); call.resolve(res); return; }
            res.put("devices", describeUsb(mgr));

            if (cidRunning) { res.put("ok", true); res.put("already", true); call.resolve(res); return; }

            UsbDevice modem = null;
            for (UsbDevice d : mgr.getDeviceList().values()) if (looksLikeModem(d)) { modem = d; break; }
            if (modem == null) { res.put("ok", false); res.put("reason", "no-cdc-device"); call.resolve(res); return; }

            res.put("vendorId", modem.getVendorId());
            res.put("productId", modem.getProductId());

            // Permission is per-device and per-install; without it openDevice
            // returns null and nothing explains why, so ask and say so.
            if (!mgr.hasPermission(modem)) {
                PendingIntent pi = PendingIntent.getBroadcast(getContext(), 0,
                        new Intent(ACTION_USB_PERMISSION),
                        android.os.Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                mgr.requestPermission(modem, pi);
                res.put("ok", false); res.put("reason", "permission-requested");
                call.resolve(res); return;   // the prompt is on screen; call again after
            }

            UsbInterface iface = null;
            UsbEndpoint in = null, out = null;
            for (int i = 0; i < modem.getInterfaceCount() && in == null; i++) {
                UsbInterface f = modem.getInterface(i);
                UsbEndpoint ci = null, co = null;
                for (int e = 0; e < f.getEndpointCount(); e++) {
                    UsbEndpoint ep = f.getEndpoint(e);
                    if (ep.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
                    if (ep.getDirection() == UsbConstants.USB_DIR_IN) ci = ep; else co = ep;
                }
                if (ci != null && co != null) { iface = f; in = ci; out = co; }
            }
            if (iface == null) { res.put("ok", false); res.put("reason", "no-bulk-endpoints"); call.resolve(res); return; }

            UsbDeviceConnection conn = mgr.openDevice(modem);
            if (conn == null) { res.put("ok", false); res.put("reason", "open-failed"); call.resolve(res); return; }
            if (!conn.claimInterface(iface, true)) {
                conn.close();
                res.put("ok", false); res.put("reason", "claim-failed"); call.resolve(res); return;
            }

            cidConn = conn; cidIface = iface; cidRunning = true;
            final UsbEndpoint fin = in, fout = out;
            cidThread = new Thread(() -> readModem(fin, fout));
            cidThread.setDaemon(true);
            cidThread.start();

            res.put("ok", true);
            call.resolve(res);
        } catch (Throwable t) {
            res.put("ok", false);
            res.put("reason", "error: " + t.getMessage());
            call.resolve(res);
        }
    }

    /** The raw lines the modem has sent — for diagnosing an install with no cable. */
    @PluginMethod
    public void getCallerIdLog(PluginCall call) {
        JSObject res = new JSObject();
        JSArray arr = new JSArray();
        synchronized (cidLog) { for (String s : cidLog) arr.put(s); }
        res.put("ok", true);
        res.put("running", cidRunning);
        res.put("lines", arr);
        call.resolve(res);
    }

    private void writeAt(UsbEndpoint out, String cmd) {
        try {
            byte[] b = (cmd + "\r").getBytes(java.nio.charset.StandardCharsets.US_ASCII);
            cidConn.bulkTransfer(out, b, b.length, 1500);
            cidNote(">> " + cmd);
            Thread.sleep(300);
        } catch (Throwable t) { /* logged by the reader when nothing comes back */ }
    }

    private void readModem(UsbEndpoint in, UsbEndpoint out) {
        // Enable formatted caller ID. Both spellings are sent because which one
        // a modem accepts depends on its chipset, and an unsupported one is
        // simply answered with ERROR — harmless.
        writeAt(out, "ATZ");
        writeAt(out, "AT+VCID=1");
        writeAt(out, "AT#CID=1");

        byte[] buf = new byte[512];
        StringBuilder line = new StringBuilder();
        while (cidRunning) {
            try {
                int n = cidConn.bulkTransfer(in, buf, buf.length, 2000);
                if (n <= 0) continue;
                for (int i = 0; i < n; i++) {
                    char c = (char) (buf[i] & 0xFF);
                    if (c == '\n' || c == '\r') {
                        String s = line.toString().trim();
                        line.setLength(0);
                        if (s.isEmpty()) continue;
                        cidNote(s);
                        String number = parseNumber(s);
                        if (number != null) {
                            JSObject ev = new JSObject();
                            ev.put("number", number);
                            notifyListeners("callerId", ev);
                        }
                    } else if (line.length() < 200) {
                        line.append(c);
                    }
                }
            } catch (Throwable t) {
                cidNote("!! read error: " + t.getMessage());
                break;
            }
        }
    }

    /* Formatted caller ID is a labelled line, but the label and the spacing vary:
       "NMBR = 07700900123", "NMBR=07700900123", "NUMBER = ...", "CALLERID=...".
       Match the label loosely and keep only the digits (plus a leading +), so a
       trailing space or a stray character can't lose us the call. */
    static String parseNumber(String s) {
        String up = s.toUpperCase(java.util.Locale.UK);
        if (!(up.startsWith("NMBR") || up.startsWith("NUMBER") || up.startsWith("CALLERID"))) return null;
        int eq = s.indexOf('=');
        if (eq < 0) return null;
        String raw = s.substring(eq + 1).trim();
        StringBuilder digits = new StringBuilder();
        for (char c : raw.toCharArray()) {
            if (Character.isDigit(c) || (c == '+' && digits.length() == 0)) digits.append(c);
        }
        String out = digits.toString();
        // "P" (private) and "O" (out of area) arrive in this field too — they are
        // not numbers and must not reach the till as one.
        return out.length() >= 6 ? out : null;
    }
}
