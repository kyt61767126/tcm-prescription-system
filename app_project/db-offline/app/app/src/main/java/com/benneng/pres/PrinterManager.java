package com.benneng.pres;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * ★ 2026-11-01 App 内置热敏处方打印机（WiFi TCP 9100 / 蓝牙经典 SPP）。
 *
 * 链路：处方 HTML → 隐藏 WebView（按纸宽 203dpi 精确定尺）→ 软件层直绘 Bitmap
 *      → ESC/POS 位图指令（GS v 0）→ Socket/RFCOMM 发送 → 走纸 + 切纸。
 * 未绑定或发送失败由调用方回退系统打印面板（可导出 PDF）。
 */
public final class PrinterManager {

    private static final String TAG = "HKZY-Printer";

    private static final String PREFS_NAME = "hkzy_printer";
    private static final String KEY_TYPE = "type";
    private static final String KEY_HOST = "host";
    private static final String KEY_PORT = "port";
    private static final String KEY_MAC = "mac";
    private static final String KEY_NAME = "name";
    private static final String KEY_WIDTH = "widthMm";
    private static final String KEY_AUTO_CUT = "autoCut";

    private static final String TYPE_WIFI = "wifi";
    private static final String TYPE_BT = "bt";
    private static final int DEF_PORT = 9100;
    private static final int DEF_WIDTH_MM = 148;
    private static final int MIN_WIDTH_MM = 40;
    private static final int MAX_WIDTH_MM = 160;
    /** 203dpi ≈ 8 dots/mm */
    private static final int DOTS_PER_MM = 8;
    /** 处方纸版式：A5 原尺寸（宽 148mm × 高 210mm），宽度可配、高度按比例换算 */
    private static final int PAGE_WIDTH_MM = 148;
    private static final int PAGE_HEIGHT_MM = 210;
    private static final int REQ_BT_CONNECT = 0x9001;
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private static PrinterManager sInstance;
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    private final Context appContext;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    /** 打印结果回调（主线程） */
    public interface Callback {
        void done(boolean ok, String message);
    }

    private PrinterManager(Context context) {
        this.appContext = context.getApplicationContext();
    }

    public static synchronized PrinterManager get(Context context) {
        if (sInstance == null) {
            sInstance = new PrinterManager(context);
        }
        return sInstance;
    }

    // ------------------------------------------------------------------
    // 配置读写
    // ------------------------------------------------------------------
    private SharedPreferences prefs() {
        return appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private String type() {
        return prefs().getString(KEY_TYPE, "");
    }

    private String host() {
        return prefs().getString(KEY_HOST, "");
    }

    private int port() {
        int v = prefs().getInt(KEY_PORT, DEF_PORT);
        return (v > 0 && v <= 65535) ? v : DEF_PORT;
    }

    private String mac() {
        return prefs().getString(KEY_MAC, "");
    }

    private String btName() {
        return prefs().getString(KEY_NAME, "");
    }

    private int widthMm() {
        int v = prefs().getInt(KEY_WIDTH, DEF_WIDTH_MM);
        if (v < MIN_WIDTH_MM) v = MIN_WIDTH_MM;
        if (v > MAX_WIDTH_MM) v = MAX_WIDTH_MM;
        return v;
    }

    private boolean autoCut() {
        return prefs().getBoolean(KEY_AUTO_CUT, true);
    }

    private String label() {
        if (TYPE_WIFI.equals(type())) return host() + ":" + port();
        String n = btName();
        String m = mac();
        if (m == null || m.isEmpty()) return n;
        return (n == null || n.isEmpty()) ? m : (n + " (" + m + ")");
    }

    public boolean isBound() {
        if (TYPE_WIFI.equals(type())) return !host().trim().isEmpty();
        if (TYPE_BT.equals(type())) return !mac().trim().isEmpty();
        return false;
    }

    public String configJson() {
        try {
            JSONObject o = new JSONObject();
            o.put("bound", isBound());
            o.put("type", type());
            o.put("label", label());
            o.put("widthMm", widthMm());
            o.put("autoCut", autoCut());
            return o.toString();
        } catch (Exception e) {
            return "{\"bound\":false}";
        }
    }

    public void save(String type, String host, int port, String mac, String name, int widthMm, boolean autoCut) {
        int w = Math.max(MIN_WIDTH_MM, Math.min(MAX_WIDTH_MM, widthMm));
        prefs().edit()
                .putString(KEY_TYPE, type)
                .putString(KEY_HOST, host == null ? "" : host.trim())
                .putInt(KEY_PORT, (port > 0 && port <= 65535) ? port : DEF_PORT)
                .putString(KEY_MAC, mac == null ? "" : mac.trim())
                .putString(KEY_NAME, name == null ? "" : name.trim())
                .putInt(KEY_WIDTH, w)
                .putBoolean(KEY_AUTO_CUT, autoCut)
                .apply();
    }

    public void clear() {
        prefs().edit().clear().apply();
    }

    // ------------------------------------------------------------------
    // 打印入口
    // ------------------------------------------------------------------
    /** 渲染处方 HTML 并发送到打印机（回调在主线程） */
    public void printHtml(final Activity activity, final String html, final Callback callback) {
        if (activity == null) {
            deliver(callback, false, "界面已关闭");
            return;
        }
        if (!isBound()) {
            deliver(callback, false, "未绑定打印机");
            return;
        }
        if (TYPE_BT.equals(type()) && !hasBtPermission(activity)) {
            requestBtPermission(activity);
            deliver(callback, false, "未授予蓝牙权限");
            return;
        }
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                renderToBitmapPage(activity, html == null ? "" : html, callback);
            }
        });
    }

    /** 打印测试页（用于现场校准纸宽/边距） */
    public void testPrint(final Activity activity, final Callback callback) {
        if (activity == null) {
            deliver(callback, false, "界面已关闭");
            return;
        }
        if (!isBound()) {
            deliver(callback, false, "未绑定打印机");
            return;
        }
        if (TYPE_BT.equals(type()) && !hasBtPermission(activity)) {
            requestBtPermission(activity);
            deliver(callback, false, "未授予蓝牙权限");
            return;
        }
        IO.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    byte[] data = buildTestPage();
                    sendBytes(data);
                    deliver(callback, true, "测试页已发送");
                } catch (Exception e) {
                    Log.e(TAG, "testPrint 失败", e);
                    deliver(callback, false, msgOf(e));
                }
            }
        });
    }

    // ------------------------------------------------------------------
    // HTML → Bitmap（203dpi 精确按纸宽渲染）→ ESC/POS
    //   ★ 实现说明：原计划 WebView→PDF→PdfRenderer，但 Android SDK 把
    //   PrintDocumentAdapter.LayoutResultCallback/WriteResultCallback 的构造器
    //   置为包内可见（javap android-36 确认），App 侧无法实例化，onLayout/onWrite
    //   无法被调用。改为把隐藏 WebView 按「纸宽 dots × A5 比例高度」精确定尺，
    //   用 setInitialScale 把 CSS 1mm(=3.7795 px) 映射到 8 dots(203dpi) 后软件层
    //   直绘到同尺寸 Bitmap——宽度裁剪与像素密度均可控，不经过系统打印面板。
    // ------------------------------------------------------------------
    private void renderToBitmapPage(final Activity activity, final String html, final Callback callback) {
        final AtomicBoolean done = new AtomicBoolean(false);
        final ViewGroup rootView = (ViewGroup) activity.findViewById(android.R.id.content);
        if (rootView == null) {
            deliver(callback, false, "页面容器不可用");
            return;
        }
        final int dots = widthMm() * DOTS_PER_MM;
        final int heightDots = (int) Math.round(dots * (PAGE_HEIGHT_MM / (double) PAGE_WIDTH_MM));
        final WebView wv = new WebView(activity);

        try {
            wv.getSettings().setJavaScriptEnabled(false);
            wv.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
            // CSS 1mm = 96/25.4 px；目标 1mm = 8 dots → 每 CSS px 需 dots/cssWidth 设备像素
            float cssWidthPx = PAGE_WIDTH_MM * 96f / 25.4f;
            float density = activity.getResources().getDisplayMetrics().density;
            if (density <= 0) density = 1f;
            int scalePercent = Math.round((dots / cssWidthPx) / density * 100f);
            if (scalePercent > 0) wv.setInitialScale(scalePercent);
            rootView.addView(wv, new ViewGroup.LayoutParams(dots, heightDots));
            wv.setVisibility(View.INVISIBLE);
        } catch (Exception e) {
            safeCleanup(wv);
            deliver(callback, false, msgOf(e));
            return;
        }

        final AtomicBoolean loaded = new AtomicBoolean(false);
        wv.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (!loaded.compareAndSet(false, true)) return;
                // 字体/水印渲染留 300ms 余量
                mainHandler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        captureAndSend(activity, wv, callback, done);
                    }
                }, 300);
            }
        });

        // 兜底：渲染卡死时回退系统打印
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (done.compareAndSet(false, true)) {
                    safeCleanup(wv);
                    deliver(callback, false, "内置打印超时");
                }
            }
        }, 12000);

        // ★ 处方模板自带 <meta name="viewport" content="width=device-width, initial-scale=1.0">：
        //   Chromium WebView 会优先采用页面级 initial-scale 而忽略 setInitialScale，导致按
        //   A5 真实尺寸定尺的版面被横向裁切（右半页丢失）。渲染前剔除该标签，缩放权收归原生。
        //   仅作用于这一个隐藏渲染 WebView，处方模板本身与其他端不受影响。
        String renderHtml = html.replaceAll("(?i)<meta[^>]+name=[\"']viewport[\"'][^>]*>", "");
        try {
            wv.loadDataWithBaseURL(null, renderHtml, "text/html", "UTF-8", null);
        } catch (Exception e) {
            if (done.compareAndSet(false, true)) {
                safeCleanup(wv);
                deliver(callback, false, msgOf(e));
            }
        }
    }

    private void captureAndSend(final Activity activity, final WebView wv,
                                final Callback callback, final AtomicBoolean done) {
        if (done.get()) {
            safeCleanup(wv);
            return;
        }
        byte[] data;
        try {
            int w = Math.max(1, wv.getWidth());
            int h = Math.max(1, wv.getHeight());
            Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            bmp.eraseColor(Color.WHITE);
            Canvas canvas = new Canvas(bmp);
            wv.draw(canvas);
            safeCleanup(wv);
            data = encodeEscPos(bmp, autoCut());
            bmp.recycle();
        } catch (Exception e) {
            Log.e(TAG, "渲染处方位图失败", e);
            safeCleanup(wv);
            if (done.compareAndSet(false, true)) deliver(callback, false, msgOf(e));
            return;
        }
        IO.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    sendBytes(data);
                    if (done.compareAndSet(false, true)) deliver(callback, true, "已发送到打印机");
                } catch (Exception e) {
                    Log.e(TAG, "发送打印数据失败", e);
                    if (done.compareAndSet(false, true)) deliver(callback, false, msgOf(e));
                }
            }
        });
    }

    /** 位图 → ESC/POS：初始化 + 逐带 GS v 0（亮度<160 记黑点）+ 走纸 + 切纸 */
    private byte[] encodeEscPos(Bitmap bmp, boolean cut) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(0x1B);
        out.write(0x40);
        int width = bmp.getWidth();
        int height = bmp.getHeight();
        int bytesPerRow = (width + 7) / 8;
        int[] row = new int[width];
        for (int y0 = 0; y0 < height; y0 += 255) {
            int bandH = Math.min(255, height - y0);
            out.write(0x1D);
            out.write(0x76);
            out.write(0x30);
            out.write(0x00);
            out.write(bytesPerRow & 0xFF);
            out.write((bytesPerRow >> 8) & 0xFF);
            out.write(bandH & 0xFF);
            out.write((bandH >> 8) & 0xFF);
            for (int y = y0; y < y0 + bandH; y++) {
                bmp.getPixels(row, 0, width, 0, y, width, 1);
                for (int bx = 0; bx < bytesPerRow; bx++) {
                    int b = 0;
                    for (int bit = 0; bit < 8; bit++) {
                        int x = bx * 8 + bit;
                        if (x >= width) break;
                        int c = row[x];
                        int lum = (Color.red(c) * 299 + Color.green(c) * 587 + Color.blue(c) * 114) / 1000;
                        if (lum < 160) b |= (0x80 >>> bit);
                    }
                    out.write(b);
                }
            }
        }
        // 走纸：切纸前 3 行；不切纸时多走 6 行
        out.write(0x1B);
        out.write(0x64);
        out.write(cut ? 3 : 6);
        if (cut) {
            out.write(0x1D);
            out.write(0x56);
            out.write(0x42);
            out.write(0x00);
        }
        return out.toByteArray();
    }

    /** 测试页：诊所名 / 标题 / 时间 / 配置摘要 / 纸宽点阵 / 横线 */
    private byte[] buildTestPage() {
        int dots = widthMm() * DOTS_PER_MM;
        int h = Math.max(320, dots * 11 / 20);
        Bitmap bmp = Bitmap.createBitmap(dots, h, Bitmap.Config.ARGB_8888);
        bmp.eraseColor(Color.WHITE);
        Canvas canvas = new Canvas(bmp);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(Color.BLACK);

        float big = Math.max(18f, dots / 22f);
        float mid = Math.max(12f, dots / 36f);
        float small = Math.max(9f, dots / 52f);
        float x = Math.max(8f, dots * 0.04f);
        float y = big * 1.4f;

        p.setTypeface(Typeface.DEFAULT_BOLD);
        p.setTextSize(big);
        canvas.drawText("惠康中医诊所", x, y, p);

        y += mid * 1.6f;
        p.setTextSize(mid);
        canvas.drawText("惠康中医 · 打印测试", x, y, p);

        p.setTypeface(Typeface.DEFAULT);
        p.setTextSize(small);
        String time = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.CHINA).format(new java.util.Date());
        y += small * 1.6f;
        canvas.drawText("时间：" + time, x, y, p);

        y += small * 1.5f;
        canvas.drawText("连接：" + (TYPE_BT.equals(type()) ? "蓝牙经典(SPP) " : "WiFi ") + label(), x, y, p);

        y += small * 1.5f;
        canvas.drawText("纸宽：" + widthMm() + "mm（" + dots + " dots @203dpi）", x, y, p);

        y += small * 1.5f;
        canvas.drawText("切纸：" + (autoCut() ? "自动切纸" : "不切纸"), x, y, p);

        y += small * 2f;
        canvas.drawRect(x, y, dots - x, y + Math.max(2f, dots / 300f), p);
        y += small * 1.8f;
        p.setTextSize(small);
        canvas.drawText("字迹清晰、边距完整即可正常使用；纸宽不足时请调小纸宽后重试。", x, y, p);

        byte[] data = encodeEscPos(bmp, autoCut());
        bmp.recycle();
        return data;
    }

    // ------------------------------------------------------------------
    // 发送（WiFi TCP 9100 / 蓝牙经典 SPP）
    // ------------------------------------------------------------------
    private void sendBytes(byte[] data) throws Exception {
        String t = type();
        if (TYPE_WIFI.equals(t)) {
            sendWifi(data);
        } else if (TYPE_BT.equals(t)) {
            sendBluetooth(data);
        } else {
            throw new Exception("未绑定打印机");
        }
    }

    private void sendWifi(byte[] data) throws Exception {
        Socket socket = new Socket();
        try {
            socket.connect(new InetSocketAddress(host(), port()), 5000);
            OutputStream out = socket.getOutputStream();
            out.write(data);
            out.flush();
        } finally {
            try { socket.close(); } catch (Exception ignored) { }
        }
    }

    private void sendBluetooth(byte[] data) throws Exception {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) throw new Exception("本机不支持蓝牙");
        if (!adapter.isEnabled()) throw new Exception("蓝牙未开启");
        try { adapter.cancelDiscovery(); } catch (Exception ignored) { }
        BluetoothDevice device = adapter.getRemoteDevice(mac());
        BluetoothSocket socket = null;
        Exception last = null;
        // 首次 + 2 次重试（间隔 300ms）
        for (int attempt = 0; attempt < 3; attempt++) {
            BluetoothSocket s = null;
            try {
                s = device.createRfcommSocketToServiceRecord(SPP_UUID);
                s.connect();
                socket = s;
                break;
            } catch (Exception e) {
                last = e;
                if (s != null) {
                    try { s.close(); } catch (Exception ignored) { }
                }
                if (attempt < 2) {
                    try { Thread.sleep(300); } catch (InterruptedException ignored) { }
                }
            }
        }
        if (socket == null) throw new Exception("蓝牙连接失败：" + (last != null ? last.getMessage() : "未知错误"));
        try {
            OutputStream out = socket.getOutputStream();
            int offset = 0;
            while (offset < data.length) {
                int len = Math.min(4096, data.length - offset);
                out.write(data, offset, len);
                offset += len;
            }
            out.flush();
        } finally {
            try { socket.close(); } catch (Exception ignored) { }
        }
    }

    // ------------------------------------------------------------------
    // 蓝牙权限（Android 12+ BLUETOOTH_CONNECT）
    // ------------------------------------------------------------------
    private boolean hasBtPermission(Activity activity) {
        if (Build.VERSION.SDK_INT < 31) return true;
        try {
            return activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        } catch (Exception e) {
            return true;
        }
    }

    private void requestBtPermission(final Activity activity) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    Toast.makeText(activity, "请允许「附近的设备」权限后重试打印", Toast.LENGTH_LONG).show();
                    activity.requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, REQ_BT_CONNECT);
                } catch (Exception e) {
                    Log.w(TAG, "requestPermissions 失败: " + e.getMessage());
                }
            }
        });
    }

    // ------------------------------------------------------------------
    // 设置对话框（纯代码布局，不新增 XML）
    // ------------------------------------------------------------------
    private static final class SettingsForm {
        RadioGroup group;
        EditText ip;
        EditText port;
        Spinner spinner;
        TextView btHint;
        EditText width;
        CheckBox cut;
        final List<String> macs = new ArrayList<>();
        final List<String> labels = new ArrayList<>();
    }

    public void showSettingsDialog(final Activity activity, final Runnable onSaved) {
        if (activity == null) return;
        final SettingsForm form = new SettingsForm();
        int pad = dp(activity, 12);

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, dp(activity, 6), pad, dp(activity, 6));

        TextView typeLabel = new TextView(activity);
        typeLabel.setText("连接方式");
        root.addView(typeLabel);

        form.group = new RadioGroup(activity);
        RadioButton rbWifi = new RadioButton(activity);
        rbWifi.setText("WiFi（TCP 9100）");
        RadioButton rbBt = new RadioButton(activity);
        rbBt.setText("蓝牙经典（SPP）");
        form.group.addView(rbWifi);
        form.group.addView(rbBt);
        if (TYPE_BT.equals(type())) rbBt.setChecked(true); else rbWifi.setChecked(true);
        root.addView(form.group);

        // WiFi 面板
        final LinearLayout wifiPanel = new LinearLayout(activity);
        wifiPanel.setOrientation(LinearLayout.VERTICAL);
        form.ip = new EditText(activity);
        form.ip.setHint("打印机 IP，如 192.168.1.88");
        form.ip.setSingleLine(true);
        form.ip.setText(host());
        wifiPanel.addView(form.ip);
        form.port = new EditText(activity);
        form.port.setHint("端口（默认 9100）");
        form.port.setSingleLine(true);
        form.port.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        form.port.setText(String.valueOf(port()));
        wifiPanel.addView(form.port);
        root.addView(wifiPanel);

        // 蓝牙面板
        final LinearLayout btPanel = new LinearLayout(activity);
        btPanel.setOrientation(LinearLayout.VERTICAL);
        LinearLayout btRow = new LinearLayout(activity);
        btRow.setOrientation(LinearLayout.HORIZONTAL);
        form.spinner = new Spinner(activity);
        btRow.addView(form.spinner, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button refreshBtn = new Button(activity);
        refreshBtn.setText("刷新");
        btRow.addView(refreshBtn);
        btPanel.addView(btRow);
        form.btHint = new TextView(activity);
        form.btHint.setTextSize(12f);
        form.btHint.setText("仅列出系统「已配对」设备，请先在系统蓝牙设置里配对小票机");
        btPanel.addView(form.btHint);
        root.addView(btPanel);

        // 纸宽 / 切纸
        TextView widthLabel = new TextView(activity);
        widthLabel.setText("纸宽（mm，40-160，可打宽度不足时调小）");
        root.addView(widthLabel);
        form.width = new EditText(activity);
        form.width.setSingleLine(true);
        form.width.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        form.width.setText(String.valueOf(widthMm()));
        root.addView(form.width);
        form.cut = new CheckBox(activity);
        form.cut.setText("自动切纸");
        form.cut.setChecked(autoCut());
        root.addView(form.cut);

        Button clearBtn = new Button(activity);
        clearBtn.setText("清除绑定");
        root.addView(clearBtn);

        loadPairedDevices(activity, form, mac());
        form.group.setOnCheckedChangeListener(new RadioGroup.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(RadioGroup group, int checkedId) {
                boolean wifi = group.getCheckedRadioButtonId() == group.getChildAt(0).getId();
                wifiPanel.setVisibility(wifi ? View.VISIBLE : View.GONE);
                btPanel.setVisibility(wifi ? View.GONE : View.VISIBLE);
            }
        });
        boolean wifiMode = form.group.getCheckedRadioButtonId() == form.group.getChildAt(0).getId();
        wifiPanel.setVisibility(wifiMode ? View.VISIBLE : View.GONE);
        btPanel.setVisibility(wifiMode ? View.GONE : View.VISIBLE);

        refreshBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                loadPairedDevices(activity, form, mac());
            }
        });

        ScrollView scroll = new ScrollView(activity);
        scroll.addView(root);

        AlertDialog.Builder builder = new AlertDialog.Builder(activity);
        builder.setTitle("内置热敏打印机设置");
        builder.setView(scroll);
        builder.setPositiveButton("保存", null);
        builder.setNegativeButton("取消", null);
        builder.setNeutralButton("测试打印", null);
        final AlertDialog dialog = builder.create();
        dialog.setOnShowListener(new android.content.DialogInterface.OnShowListener() {
            @Override
            public void onShow(android.content.DialogInterface d) {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        if (!persistForm(activity, form, false)) return;
                        Toast.makeText(activity, "打印机配置已保存", Toast.LENGTH_SHORT).show();
                        if (onSaved != null) onSaved.run();
                        dialog.dismiss();
                    }
                });
                dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        if (!persistForm(activity, form, false)) return;
                        if (onSaved != null) onSaved.run();
                        testPrint(activity, new Callback() {
                            @Override
                            public void done(boolean ok, String message) {
                                Toast.makeText(activity, ok ? "测试页已发送，请检查出纸" : ("测试失败：" + message),
                                        Toast.LENGTH_LONG).show();
                            }
                        });
                    }
                });
                dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        dialog.dismiss();
                    }
                });
                clearBtn.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        clear();
                        Toast.makeText(activity, "已清除打印机绑定", Toast.LENGTH_SHORT).show();
                        if (onSaved != null) onSaved.run();
                        dialog.dismiss();
                    }
                });
            }
        });
        dialog.show();
    }

    /** 读取表单并落库；返回 false 表示校验未通过（已 Toast 提示） */
    private boolean persistForm(Activity activity, SettingsForm form, boolean silent) {
        boolean wifi = form.group.getCheckedRadioButtonId() == form.group.getChildAt(0).getId();
        String type = wifi ? TYPE_WIFI : TYPE_BT;
        String host = form.ip.getText().toString().trim();
        int port = DEF_PORT;
        try {
            String ps = form.port.getText().toString().trim();
            if (!ps.isEmpty()) port = Integer.parseInt(ps);
        } catch (Exception e) {
            port = DEF_PORT;
        }
        if (port <= 0 || port > 65535) port = DEF_PORT;

        String selectedMac = "";
        String selectedName = "";
        int idx = form.spinner.getSelectedItemPosition();
        if (idx >= 0 && idx < form.macs.size()) {
            selectedMac = form.macs.get(idx);
            selectedName = form.labels.get(idx);
        }

        int width = DEF_WIDTH_MM;
        try {
            String ws = form.width.getText().toString().trim();
            if (!ws.isEmpty()) width = Integer.parseInt(ws);
        } catch (Exception e) {
            width = DEF_WIDTH_MM;
        }
        if (width < MIN_WIDTH_MM || width > MAX_WIDTH_MM) {
            if (!silent) {
                Toast.makeText(activity, "纸宽需在 " + MIN_WIDTH_MM + "-" + MAX_WIDTH_MM + "mm 之间",
                        Toast.LENGTH_LONG).show();
            }
            return false;
        }

        if (wifi) {
            if (host.isEmpty()) {
                if (!silent) Toast.makeText(activity, "请填写打印机 IP", Toast.LENGTH_LONG).show();
                return false;
            }
            save(type, host, port, "", "", width, form.cut.isChecked());
        } else {
            if (selectedMac.isEmpty()) {
                if (!silent) Toast.makeText(activity, "请选择一台已配对的蓝牙小票机", Toast.LENGTH_LONG).show();
                return false;
            }
            save(type, "", port, selectedMac, selectedName, width, form.cut.isChecked());
        }
        return true;
    }

    /** 列出系统已配对设备（不做扫描发现） */
    private void loadPairedDevices(Activity activity, SettingsForm form, String presetMac) {
        form.macs.clear();
        form.labels.clear();
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            form.btHint.setText("未检测到蓝牙适配器");
        } else if (Build.VERSION.SDK_INT >= 31 && !hasBtPermission(activity)) {
            form.btHint.setText("需先授予「附近的设备」权限才能列出已配对打印机，授权后点「刷新」");
            requestBtPermission(activity);
        } else {
            try {
                Set<BluetoothDevice> bonded = adapter.getBondedDevices();
                if (bonded != null) {
                    for (BluetoothDevice d : bonded) {
                        String name = d.getName();
                        String address = d.getAddress();
                        form.macs.add(address);
                        form.labels.add((name == null || name.isEmpty() ? "未知设备" : name) + " (" + address + ")");
                    }
                }
                form.btHint.setText(form.macs.isEmpty()
                        ? "未找到已配对设备，请先在系统蓝牙设置里配对小票机"
                        : "共 " + form.macs.size() + " 台已配对设备");
            } catch (Exception e) {
                form.btHint.setText("读取已配对设备失败：" + msgOf(e));
            }
        }
        ArrayAdapter<String> adapterView = new ArrayAdapter<>(activity,
                android.R.layout.simple_spinner_item, form.labels);
        adapterView.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        form.spinner.setAdapter(adapterView);
        int sel = 0;
        for (int i = 0; i < form.macs.size(); i++) {
            if (form.macs.get(i).equalsIgnoreCase(presetMac)) sel = i;
        }
        if (!form.macs.isEmpty()) form.spinner.setSelection(sel);
    }

    // ------------------------------------------------------------------
    // 工具
    // ------------------------------------------------------------------
    private void deliver(final Callback callback, final boolean ok, final String message) {
        if (callback == null) return;
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    callback.done(ok, message);
                } catch (Exception e) {
                    Log.w(TAG, "打印回调异常: " + e.getMessage());
                }
            }
        });
    }

    private void safeCleanup(final WebView wv) {
        if (wv == null) return;
        Runnable r = new Runnable() {
            @Override
            public void run() {
                try {
                    ViewGroup parent = (ViewGroup) wv.getParent();
                    if (parent != null) parent.removeView(wv);
                    wv.destroy();
                } catch (Exception e) {
                    Log.w(TAG, "WebView 清理失败: " + e.getMessage());
                }
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) r.run(); else mainHandler.post(r);
    }

    private static String msgOf(Throwable e) {
        if (e == null) return "未知错误";
        String m = e.getMessage();
        return (m == null || m.isEmpty()) ? e.getClass().getSimpleName() : m;
    }

    private static int dp(Context context, int value) {
        try {
            return (int) (value * context.getResources().getDisplayMetrics().density + 0.5f);
        } catch (Exception e) {
            return value;
        }
    }
}
