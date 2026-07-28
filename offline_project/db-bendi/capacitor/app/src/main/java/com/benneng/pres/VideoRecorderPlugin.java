package com.benneng.pres;

import android.content.Context;
import android.webkit.JavascriptInterface;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;

@CapacitorPlugin(name = "VideoRecorder")
public class VideoRecorderPlugin extends Plugin {

    @Override
    public void load() {
        super.load();
        // 注入录像拍照脚本
        injectVideoRecorderScript();
    }

    private void injectVideoRecorderScript() {
        try {
            Context ctx = getContext();
            InputStream is = ctx.getAssets().open("video-recorder-inject.js");
            byte[] buffer = new byte[is.available()];
            is.read(buffer);
            is.close();
            String script = new String(buffer, "UTF-8");

            getBridge().getWebView().post(() -> {
                getBridge().getWebView().evaluateJavascript(script, null);
            });
        } catch (Exception e) {
            // ignore
        }
    }
}
