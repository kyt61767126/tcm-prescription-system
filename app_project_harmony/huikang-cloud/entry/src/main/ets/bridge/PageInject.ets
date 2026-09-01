/**
 * 页面注入层调度器（云端版 Week1）
 * ------------------------------------------------------------------
 * 复刻安卓云端版 MainActivity 的注入时序（2026-09-01 提取）：
 *
 *   onPageStarted：
 *     1. cloud-autocomplete-off.js（禁自动填充，提前注入）
 *
 *   onPageFinished：
 *     1. window.__STATUS_BAR_HEIGHT__（鸿蒙端内容从状态栏下方开始，置 0，Week2 真机校准）
 *     2. window.__HK_APP_VERSION__ / __HK_APP_CODE__（供 cloud-layout-fix.js 显示版本号）
 *     3. cloud-electron-api-shim.js（electronAPI 桥，立即注入）
 *     4. cloud-layout-fix.js（布局修正 + 版本号，0/600/1500ms 三次重试）
 *     5. cloud-app-buttons.js（APP 专属按钮，立即 + 1500ms 重试）
 *     6. video-recorder-inject.js（延迟 300ms，避免阻塞首屏）
 *
 * 注入脚本源文件位于 app_project_harmony/shared-inject/，
 * 由 tools/copy-assets.cjs 拷贝到 rawfile/inject/（安卓工程零改动）。
 */
import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x0000;
const TAG: string = 'HuikangInject';

const INJECT_AUTOCOMPLETE: string = 'inject/cloud-autocomplete-off.js';
const INJECT_ELECTRON_API: string = 'inject/cloud-electron-api-shim.js';
const INJECT_LAYOUT_FIX: string = 'inject/cloud-layout-fix.js';
const INJECT_APP_BUTTONS: string = 'inject/cloud-app-buttons.js';
const INJECT_VIDEO_RECORDER: string = 'video-recorder-inject.js';

export class PageInject {
  private context: common.UIAbilityContext;
  private controller: webview.WebviewController;
  private cache: Map<string, string> = new Map();

  constructor(context: common.UIAbilityContext, controller: webview.WebviewController) {
    this.context = context;
    this.controller = controller;
  }

  /** 启动时预加载全部注入脚本到内存（对齐安卓 preloadVideoRecorderScript 思路） */
  async preload(): Promise<void> {
    const names: string[] = [
      INJECT_AUTOCOMPLETE,
      INJECT_ELECTRON_API,
      INJECT_LAYOUT_FIX,
      INJECT_APP_BUTTONS,
      INJECT_VIDEO_RECORDER
    ];
    for (const name of names) {
      await this.readScript(name);
    }
    hilog.info(DOMAIN, TAG, '注入脚本预加载完成，共 %{public}d 个', names.length);
  }

  /** 对齐安卓 onPageStarted：提前注入 anti-autofill + AndroidAppExit shim */
  onPageBegin(): void {
    this.runScript(this.readScriptSync(INJECT_AUTOCOMPLETE));
    // AndroidAppExit shim：安卓为独立 JS 接口对象，鸿蒙端经 AndroidNative 代理
    this.runScript(
      'if(!window.AndroidAppExit){window.AndroidAppExit={exit:function(){AndroidNative.__exitApp();}};}'
    );
  }

  /** 对齐安卓 onPageFinished 的完整注入序列 */
  onPageEnd(): void {
    // 1) 状态栏高度（鸿蒙默认内容从状态栏下方开始，置 0，Week2 真机校准）
    this.runScript('window.__STATUS_BAR_HEIGHT__ = 0;');
    // 2) 版本信息（供 cloud-layout-fix.js 使用）
    this.runScript(
      'window.__HK_APP_VERSION__ = \'1.0.0\'; window.__HK_APP_CODE__ = 1000000;'
    );
    // 3) electronAPI shim（立即）
    this.runScript(this.readScriptSync(INJECT_ELECTRON_API));
    // 4) 布局修正 + 版本号（0/600/1500ms 三次重试，脚本自带幂等守卫）
    this.injectLayoutFix();
    // 5) APP 专属按钮（立即 + 1500ms 重试）
    this.injectAppButtons();
    setTimeout(() => this.injectAppButtons(), 1500);
    // 6) 录像拍照脚本（延迟 300ms，与安卓一致，避免阻塞首屏）
    setTimeout(() => {
      this.runScript(this.readScriptSync(INJECT_VIDEO_RECORDER));
    }, 300);
  }

  private injectLayoutFix(): void {
    this.runScript(this.readScriptSync(INJECT_LAYOUT_FIX));
    setTimeout(() => this.runScript(this.readScriptSync(INJECT_LAYOUT_FIX)), 600);
    setTimeout(() => this.runScript(this.readScriptSync(INJECT_LAYOUT_FIX)), 1500);
  }

  private injectAppButtons(): void {
    this.runScript(this.readScriptSync(INJECT_APP_BUTTONS));
  }

  // ==================================================================
  // 内部工具
  // ==================================================================

  private async readScript(name: string): Promise<string> {
    const cached: string | undefined = this.cache.get(name);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const content: Uint8Array = await this.context.resourceManager.getRawFileContent(name);
      const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
      const text: string = decoder.decodeToString(content);
      this.cache.set(name, text);
      return text;
    } catch (e) {
      hilog.error(DOMAIN, TAG, '读取注入脚本失败: %{public}s, %{public}s', name, JSON.stringify(e));
      this.cache.set(name, '');
      return '';
    }
  }

  private readScriptSync(name: string): string {
    const cached: string | undefined = this.cache.get(name);
    return cached ?? '';
  }

  private runScript(script: string): void {
    if (!script || script.length === 0) {
      return;
    }
    try {
      this.controller.runJavaScript(script); // 异步执行，无需等待
    } catch (e) {
      hilog.error(DOMAIN, TAG, '注入脚本执行失败: %{public}s', JSON.stringify(e));
    }
  }
}
