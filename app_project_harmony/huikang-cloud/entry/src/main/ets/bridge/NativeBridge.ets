/**
 * 鸿蒙原生桥接层（云端版 Week1）
 * ------------------------------------------------------------------
 * 与安卓 NativeBridge 逐方法对齐（MainActivity.java switch 分支，2026-09-01 提取）：
 *   - invoke(name, jsonStr) 同步返回 JSON 字符串，格式与安卓完全一致：
 *       成功 {"success":true, ...} / 失败 {"success":false,"error":"..."}
 *   - printHtml(html)：安卓端系统打印入口（Week2 接 Print Kit，当前占位）
 *   - __exitApp()：对齐安卓 AndroidAppExit.exit()（finishAndRemoveTask）
 *
 * Week1 实现状态：
 *   ✅ openExternalUrl   —— 官网付款导引（严格白名单，与安卓一致）
 *   ✅ getVideoDirectory —— 媒体目录（沙箱路径，Week2 接 Picker 导出）
 *   ✅ __exitApp         —— 退出应用
 *   ⏳ 其余 19 个 invoke 方法为骨架，返回明确的"开发中"提示（前端 alert 可见），
 *      Week2 按媒体保存/备份/打印/分片读取逐一补齐。
 */
import { common, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x0000;
const TAG: string = 'HuikangBridge';

/** 官网下载页白名单前缀（与安卓 openExternalUrl 严格一致） */
const ALLOWED_URL_PREFIX: string = 'https://tcm-prescription-system.pages.dev/download.html';

export class NativeBridge {
  private context: common.UIAbilityContext;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  /** JS 桥入口：window.AndroidNative.invoke(name, JSON.stringify(args)) */
  invoke(name: string, jsonStr: string): string {
    hilog.info(DOMAIN, TAG, 'invoke: %{public}s', name);
    let args: Record<string, Object> = {};
    try {
      const parsed: object = JSON.parse(jsonStr ?? '{}') as object;
      args = parsed as Record<string, Object>;
    } catch (e) {
      hilog.warn(DOMAIN, TAG, 'invoke 参数解析失败: %{public}s', JSON.stringify(e));
      args = {};
    }
    try {
      switch (name) {
        // ---------- ✅ Week1 已实现 ----------
        case 'openExternalUrl':
          return this.openExternalUrl(optStr(args, 'url'));
        case 'getVideoDirectory':
          return this.getVideoDirectory();

        // ---------- ⏳ Week2 待实现（媒体保存/分片） ----------
        case 'savePrescriptionImage':
        case 'saveVideoFile':
        case 'startMediaSession':
        case 'appendMediaChunk':
        case 'commitMediaSession':
        // ---------- ⏳ Week2 待实现（备份恢复） ----------
        case 'saveBackupFile':
        case 'listBackupFiles':
        case 'readBackupFile':
        case 'backupMedia':
        case 'restoreMedia':
        // ---------- ⏳ Week2 待实现（媒体查找/读取/打开） ----------
        case 'getMediaStats':
        case 'findMediaFiles':
        case 'openFile':
        case 'readFileAsBase64':
        case 'startReadSession':
        case 'readNextChunk':
        case 'closeReadSession':
        case 'renameMediaFiles':
        case 'deleteFile':
        // ---------- ⏳ Week2 待实现（打印） ----------
        case 'printPrescription':
          return this.pending(name);

        // ---------- 与安卓行为一致：未知方法 ----------
        default:
          return failJson(`unknown method: ${name}`);
      }
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'invoke %{public}s 失败: %{public}s', name, JSON.stringify(e));
      return failJson(`bridge error: ${JSON.stringify(e)}`);
    }
  }

  /**
   * printHtml：安卓端为"调起系统打印"入口（前端主要走 printPrescription）。
   * Week1 占位记录日志，Week2 接 Print Kit 后补齐。
   */
  printHtml(html: string): void {
    hilog.info(DOMAIN, TAG, 'printHtml（Week2 待实现），html 长度: %{public}d', html ? html.length : 0);
  }

  /** 对齐安卓 AndroidAppExit.exit()：立即退出到桌面 */
  __exitApp(): void {
    hilog.info(DOMAIN, TAG, '__exitApp 退出应用');
    setTimeout(() => {
      this.context.terminateSelf();
    }, 0);
  }

  // ==================================================================
  // 已实现方法
  // ==================================================================

  /**
   * 官网付款导引：系统浏览器打开官网购买页（严格白名单）。
   * 语义与安卓 openExternalUrl 完全一致：仅放行 download.html 前缀（含 ?mid=&ed= 参数）。
   */
  private openExternalUrl(url: string): string {
    const u: string = (url ?? '').trim();
    if (!u.startsWith(ALLOWED_URL_PREFIX)) {
      hilog.warn(DOMAIN, TAG, '[openExternalUrl] 拒绝非白名单URL: %{public}s', u);
      return failJson('url not allowed');
    }
    setTimeout(() => {
      try {
        const want: Want = {
          action: 'ohos.want.action.viewData',
          uri: u
        };
        this.context.startAbility(want).catch((err: Object) => {
          hilog.warn(DOMAIN, TAG, '[openExternalUrl] 打开失败: %{public}s', JSON.stringify(err));
        });
      } catch (e) {
        hilog.warn(DOMAIN, TAG, '[openExternalUrl] 打开异常: %{public}s', JSON.stringify(e));
      }
    }, 0);
    return okJson();
  }

  /** 媒体目录：鸿蒙沙箱内媒体目录（Week2 配合 Picker 导出可见） */
  private getVideoDirectory(): string {
    try {
      const dir: string = `${this.context.filesDir}/惠康中医媒体`;
      const r: Record<string, Object> = {
        'success': true,
        'directory': dir
      };
      return JSON.stringify(r);
    } catch (e) {
      return failJson(`获取媒体目录失败: ${JSON.stringify(e)}`);
    }
  }

  /** 骨架方法统一提示（前端 alert 可见，便于真机验证桥已通） */
  private pending(name: string): string {
    return failJson(`鸿蒙版开发中：「${name}」功能将在正式版提供`);
  }
}

// ==================================================================
// 工具函数（模块级）
// ==================================================================

function okJson(): string {
  const r: Record<string, Object> = { 'success': true };
  return JSON.stringify(r);
}

function failJson(msg: string): string {
  const r: Record<string, Object> = { 'success': false, 'error': msg };
  return JSON.stringify(r);
}

function optStr(args: Record<string, Object>, key: string): string {
  const v: Object | undefined = args[key];
  if (typeof v === 'string') {
    return v as string;
  }
  return '';
}
