/**
 * 鸿蒙原生桥接层（云端版 Week2 —— 22 方法全实现）
 * ------------------------------------------------------------------
 * 与安卓 NativeBridge 逐方法对齐（MainActivity.java，2026-09-01 提取）。
 * 返回格式与安卓完全一致：成功 {"success":true,...} / 失败 {"success":false,"error":"..."}
 *
 * 鸿蒙沙箱适配策略（「沙箱+Picker」铁律，公共目录不可直写）：
 *   - 媒体目录：{filesDir}/惠康中医媒体/YYYY-MM/（图片视频同目录，对齐安卓专属目录设计）
 *   - 备份目录：{filesDir}/backups/（listBackupFiles/readBackupFile 一键恢复链路完整）
 *   - 媒体备份副本：{filesDir}/媒体备份/YYYY-MM/（backupMedia 目标，防误删）
 *   - 备份 JSON 保存成功后异步唤起系统分享（用户可选「保存到文件」导出公共目录）
 *   - 打印：print.print 不支持 HTML → 临时文件 + viewData 打开（真机验证后迭代 PDF 方案）
 *
 * 安全（对齐安卓 P1-6）：
 *   - readFileAsBase64/deleteFile 为敏感操作：调用来源校验（当前页面 host 必须为云端）
 *   - openFile/readFileAsBase64/startReadSession/deleteFile：路径白名单（媒体目录 canonical 前缀）
 *   - readBackupFile：文件名 sanitize + 必须在 backups 目录内 + .json 后缀
 */
import { common, Want } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { fileUri } from '@kit.CoreFileKit';
import { webview } from '@kit.ArkWeb';
import { util } from '@kit.ArkTS';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x0000;
const TAG: string = 'HuikangBridge';

/** 云端域名（与 Index.ets CLOUD_HOST 一致，P1-6 来源校验用） */
const CLOUD_HOST: string = 'tcm-prescription-system.pages.dev';
/** 官网下载页白名单（与安卓 openExternalUrl 严格一致） */
const ALLOWED_URL_PREFIX: string = 'https://tcm-prescription-system.pages.dev/download.html';

/** 分片读取：每片 256KB 原始字节（base64 后约 349KB，远低于调用栈限制） */
const READ_CHUNK_SIZE: number = 256 * 1024;

/** 分片上传/读取会话 */
class MediaSessionInfo {
  tempPath: string = '';
}

class ReadSessionInfo {
  fd: number = -1;
  fileSize: number = 0;
  readOffset: number = 0;
  mimeType: string = 'application/octet-stream';
}

export class NativeBridge {
  private context: common.UIAbilityContext;
  private controller: webview.WebviewController;
  private base64Helper: util.Base64Helper = new util.Base64Helper();
  private mediaSessions: Map<string, MediaSessionInfo> = new Map();
  private readSessions: Map<string, ReadSessionInfo> = new Map();

  constructor(context: common.UIAbilityContext, controller: webview.WebviewController) {
    this.context = context;
    this.controller = controller;
  }

  // ==================================================================
  // JS 桥入口
  // ==================================================================

  /** window.AndroidNative.invoke(name, JSON.stringify(args)) —— 同步返回 JSON 字符串 */
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
        // ---------- 媒体保存（沙箱 + 月份子目录） ----------
        case 'savePrescriptionImage':
          return this.savePrescriptionImage(optStr(args, 'imageData'), optStr(args, 'fileName'));
        case 'saveVideoFile':
          return this.saveVideoFile(optStr(args, 'base64Data'), optStr(args, 'fileName'));

        // ---------- 分片上传（大文件 Binder/调用栈限制） ----------
        case 'startMediaSession':
          return this.startMediaSession(optStr(args, 'fileName'));
        case 'appendMediaChunk':
          return this.appendMediaChunk(optStr(args, 'sessionId'), optStr(args, 'chunkBase64'),
            optInt(args, 'index'), optInt(args, 'total'));
        case 'commitMediaSession':
          return this.commitMediaSession(optStr(args, 'sessionId'), optStr(args, 'fileName'),
            optStr(args, 'type'));

        // ---------- 目录 ----------
        case 'getVideoDirectory':
          return this.getVideoDirectory();

        // ---------- 备份恢复（沙箱 + 分享导出） ----------
        case 'saveBackupFile':
          return this.saveBackupFile(optStr(args, 'jsonStr'), optStr(args, 'fileName'));
        case 'listBackupFiles':
          return this.listBackupFiles();
        case 'readBackupFile':
          return this.readBackupFile(optStr(args, 'fileName'));
        case 'backupMedia':
          return this.backupMedia();
        case 'restoreMedia':
          return this.restoreMedia();

        // ---------- 媒体查找/统计 ----------
        case 'getMediaStats':
          return this.getMediaStats();
        case 'findMediaFiles':
          return this.findMediaFiles(optStr(args, 'patientName'), optStr(args, 'prescriptionNo'),
            optStr(args, 'createdAt'));
        case 'renameMediaFiles':
          return this.renameMediaFiles(
            optStr(args, 'oldPatientName') || optStr(args, 'patientName'),
            optStr(args, 'newPatientName') || optStr(args, 'patientName'),
            optStr(args, 'oldNo'), optStr(args, 'newNo'));

        // ---------- 文件操作（路径白名单 + P1-6 来源校验） ----------
        case 'openFile':
          return this.openFile(optStr(args, 'filePath'), optStr(args, 'mimeType'));
        case 'readFileAsBase64':
          if (!this.isCallerAllowed()) {
            return failJson('permission denied');
          }
          return this.readFileAsBase64(optStr(args, 'filePath'));
        case 'deleteFile':
          if (!this.isCallerAllowed()) {
            return failJson('permission denied');
          }
          return this.deleteFile(optStr(args, 'filePath'));

        // ---------- 分片读取 ----------
        case 'startReadSession':
          return this.startReadSession(optStr(args, 'filePath'));
        case 'readNextChunk':
          return this.readNextChunk(optStr(args, 'sessionId'));
        case 'closeReadSession':
          return this.closeReadSession(optStr(args, 'sessionId'));

        // ---------- 打印 ----------
        case 'printPrescription':
          return this.printHtml(optStr(args, 'html'));

        // ---------- 官网付款导引 ----------
        case 'openExternalUrl':
          return this.openExternalUrl(optStr(args, 'url'));

        // ---------- 与安卓行为一致：未知方法 ----------
        default:
          return failJson(`unknown method: ${name}`);
      }
    } catch (e) {
      // 对齐安卓：catch Throwable 防止 Error 级异常导致 WebView 返回 null
      hilog.error(DOMAIN, TAG, 'invoke %{public}s 失败: %{public}s', name, JSON.stringify(e));
      return failJson(`bridge error: ${JSON.stringify(e)}`);
    }
  }

  /**
   * printHtml：安卓端为"调起系统打印"入口。
   * 鸿蒙 print.print 不支持 .html（仅 pdf/图片/office/txt/xml），
   * Week2 降级：HTML 写临时文件 + viewData 调系统应用打开（浏览器/WPS 可打印/另存）。
   * Week3 真机验证后评估 PrintDocumentAdapter + PDF 渲染方案。
   */
  printHtml(html: string): string {
    try {
      if (!html || html.length === 0) {
        return failJson('打印内容为空');
      }
      const stamp: string = formatTime(new Date());
      const fileName: string = `惠康中医处方_${stamp}.html`;
      const dir: string = `${this.context.cacheDir}/print`;
      ensureDir(dir);
      const path: string = `${dir}/${fileName}`;
      const fd: number = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE
        | fs.OpenMode.TRUNC).fd;
      fs.writeSync(fd, html);
      fs.closeSync(fd);

      const uri: string = fileUri.getUriFromPath(path);
      const want: Want = {
        action: 'ohos.want.action.viewData',
        uri: uri,
        type: 'text/html',
        flags: 0x00000001 // wantConstant.Flags.FLAG_AUTH_READ_URI_PERMISSION 授权临时读
      };
      setTimeout(() => {
        this.context.startAbility(want).catch((err: Object) => {
          hilog.warn(DOMAIN, TAG, '[printHtml] 打开失败: %{public}s', JSON.stringify(err));
        });
      }, 0);
      return okJson('已调起打印（可在打开的应用中选择打印或保存）');
    } catch (e) {
      return failJson(`打印失败: ${JSON.stringify(e)}`);
    }
  }

  /** 对齐安卓 AndroidAppExit.exit()：立即退出到桌面 */
  __exitApp(): void {
    hilog.info(DOMAIN, TAG, '__exitApp 退出应用');
    setTimeout(() => {
      this.context.terminateSelf();
    }, 0);
  }

  // ==================================================================
  // 媒体保存
  // ==================================================================

  private savePrescriptionImage(imageData: string, fileName: string): string {
    try {
      let base64: string = imageData;
      const pngPrefix: string = 'data:image/png;base64,';
      const jpegPrefix: string = 'data:image/jpeg;base64,';
      if (base64.startsWith(pngPrefix)) {
        base64 = base64.substring(pngPrefix.length);
      } else if (base64.startsWith(jpegPrefix)) {
        base64 = base64.substring(jpegPrefix.length);
      }
      const bytes: Uint8Array = this.base64Helper.decodeSync(base64);

      let safeName: string = sanitize(fileName);
      if (safeName.length === 0) {
        safeName = `prescription_${Date.now()}.jpg`;
      }
      const dir: string = `${this.getMediaDir()}/${getCurrentMonthFolder()}`;
      ensureDir(dir);
      const path: string = `${dir}/${safeName}`;
      const fd: number = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE
        | fs.OpenMode.TRUNC).fd;
      fs.writeSync(fd, bytes);
      fs.closeSync(fd);

      const r: Record<string, Object> = {
        'success': true,
        'filePath': path,
        'directory': dir
      };
      return JSON.stringify(r);
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'savePrescriptionImage 失败: %{public}s', JSON.stringify(e));
      return failJson(`${JSON.stringify(e)}`);
    }
  }

  private saveVideoFile(base64Data: string, fileName: string): string {
    try {
      const bytes: Uint8Array = this.base64Helper.decodeSync(base64Data);
      let safeName: string = sanitize(fileName);
      if (safeName.length === 0) {
        safeName = `video_${Date.now()}.webm`;
      }
      // 保留前端传入的原始扩展名（mp4/webm），不强制改名（对齐安卓注释）
      const dir: string = `${this.getMediaDir()}/${getCurrentMonthFolder()}`;
      ensureDir(dir);
      const path: string = `${dir}/${safeName}`;
      const fd: number = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE
        | fs.OpenMode.TRUNC).fd;
      fs.writeSync(fd, bytes);
      fs.closeSync(fd);

      const r: Record<string, Object> = {
        'success': true,
        'filePath': path,
        'directory': dir,
        'fileName': safeName
      };
      return JSON.stringify(r);
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'saveVideoFile 失败: %{public}s', JSON.stringify(e));
      return failJson(`${JSON.stringify(e)}`);
    }
  }

  // ==================================================================
  // 分片上传会话
  // ==================================================================

  private startMediaSession(fileName: string): string {
    try {
      const sessionId: string = `media_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      let safeName: string = sanitize(fileName);
      if (safeName.length === 0) {
        safeName = `media_${Date.now()}`;
      }
      const tempPath: string = `${this.context.cacheDir}/upload_${sessionId}_${safeName}`;
      if (fs.accessSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      const info: MediaSessionInfo = new MediaSessionInfo();
      info.tempPath = tempPath;
      this.mediaSessions.set(sessionId, info);
      const r: Record<string, Object> = {
        'success': true,
        'sessionId': sessionId
      };
      return JSON.stringify(r);
    } catch (e) {
      return failJson(`${JSON.stringify(e)}`);
    }
  }

  private appendMediaChunk(sessionId: string, chunkBase64: string, index: number, total: number): string {
    let info: MediaSessionInfo | undefined = this.mediaSessions.get(sessionId);
    try {
      if (info === undefined) {
        return failJson(`无效或已过期的 sessionId: ${sessionId}`);
      }
      const bytes: Uint8Array = this.base64Helper.decodeSync(chunkBase64);
      const fd: number = fs.openSync(info.tempPath, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE
        | fs.OpenMode.APPEND).fd;
      fs.writeSync(fd, bytes);
      fs.closeSync(fd);
      const size: number = fs.statSync(info.tempPath).size;
      if (index % 10 === 0 || index === total - 1) {
        hilog.info(DOMAIN, TAG, 'appendMediaChunk: %{public}d/%{public}d, size=%{public}d',
          index + 1, total, size);
      }
      const r: Record<string, Object> = {
        'success': true,
        'index': index,
        'total': total,
        'fileSize': size
      };
      return JSON.stringify(r);
    } catch (e) {
      // 失败清理临时文件（对齐安卓）
      if (info !== undefined) {
        this.mediaSessions.delete(sessionId);
        try {
          if (fs.accessSync(info.tempPath)) {
            fs.unlinkSync(info.tempPath);
          }
        } catch (e2) {
          hilog.warn(DOMAIN, TAG, '清理临时文件失败: %{public}s', JSON.stringify(e2));
        }
      }
      return failJson(`${JSON.stringify(e)}`);
    }
  }

  private commitMediaSession(sessionId: string, fileName: string, type: string): string {
    const info: MediaSessionInfo | undefined = this.mediaSessions.get(sessionId);
    try {
      if (info === undefined || !fs.accessSync(info.tempPath)) {
        this.mediaSessions.delete(sessionId);
        return failJson(`会话文件不存在: ${sessionId}`);
      }
      const targetDir: string = `${this.getMediaDir()}/${getCurrentMonthFolder()}`;
      ensureDir(targetDir);
      let safeName: string = sanitize(fileName);
      if (safeName.length === 0) {
        const ext: string = type === 'video' ? '.webm' : '.jpg';
        safeName = `media_${Date.now()}${ext}`;
      }
      const targetPath: string = `${targetDir}/${safeName}`;
      if (fs.accessSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      // 先 rename（同分区快速），失败则 copy（对齐安卓）
      try {
        fs.moveFileSync(info.tempPath, targetPath);
      } catch (e) {
        fs.copyFileSync(info.tempPath, targetPath);
        fs.unlinkSync(info.tempPath);
      }
      this.mediaSessions.delete(sessionId);
      const size: number = fs.statSync(targetPath).size;
      hilog.info(DOMAIN, TAG, 'commitMediaSession 成功: %{public}s, size=%{public}d', targetPath, size);
      const r: Record<string, Object> = {
        'success': true,
        'filePath': targetPath,
        'directory': targetDir,
        'fileName': safeName,
        'fileSize': size
      };
      return JSON.stringify(r);
    } catch (e) {
      if (info !== undefined) {
        this.mediaSessions.delete(sessionId);
        try {
          if (fs.accessSync(info.tempPath)) {
            fs.unlinkSync(info.tempPath);
          }
        } catch (e2) {
          hilog.warn(DOMAIN, TAG, '清理临时文件失败: %{public}s', JSON.stringify(e2));
        }
      }
      return failJson(`${JSON.stringify(e)}`);
    }
  }

  // ==================================================================
  // 目录
  // ==================================================================

  private getVideoDirectory(): string {
    try {
      const dir: string = this.getMediaDir();
      const r: Record<string, Object> = {
        'success': true,
        'directory': dir
      };
      return JSON.stringify(r);
    } catch (e) {
      return failJson(`获取媒体目录失败: ${JSON.stringify(e)}`);
    }
  }

  /** 媒体根目录：{filesDir}/惠康中医媒体（图片视频同目录，YYYY-MM 子目录） */
  private getMediaDir(): string {
    const dir: string = `${this.context.filesDir}/惠康中医媒体`;
    ensureDir(dir);
    return dir;
  }

  /** 备份目录：{filesDir}/backups */
  private getBackupDir(): string {
    const dir: string = `${this.context.filesDir}/backups`;
    ensureDir(dir);
    return dir;
  }

  /** 媒体备份副本目录：{filesDir}/媒体备份（backupMedia 目标，防误删） */
  private getMediaBackupDir(): string {
    const dir: string = `${this.context.filesDir}/媒体备份`;
    ensureDir(dir);
    return dir;
  }

  // ==================================================================
  // 备份恢复
  // ==================================================================

  private saveBackupFile(jsonStr: string, fileName: string): string {
    try {
      let safeName: string = sanitize(fileName);
      if (safeName.length === 0) {
        safeName = `backup_${Date.now()}.json`;
      }
      const dir: string = this.getBackupDir();
      const path: string = `${dir}/${safeName}`;
      const fd: number = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE
        | fs.OpenMode.TRUNC).fd;
      fs.writeSync(fd, jsonStr);
      fs.closeSync(fd);

      // 异步唤起系统分享：用户可选「保存到文件」导出到公共目录（卸载重装不丢）
      // 前端同步拿到 success 后 alert，分享面板随后弹出，不打断流程
      setTimeout(() => {
        try {
          const uri: string = fileUri.getUriFromPath(path);
          const want: Want = {
            action: 'ohos.want.action.sendData',
            uri: uri,
            type: 'application/json',
            flags: 0x00000001
          };
          this.context.startAbility(want).catch((err: Object) => {
            hilog.warn(DOMAIN, TAG, '[saveBackupFile] 分享失败: %{public}s', JSON.stringify(err));
          });
        } catch (e) {
          hilog.warn(DOMAIN, TAG, '[saveBackupFile] 分享异常: %{public}s', JSON.stringify(e));
        }
      }, 200);

      const r: Record<string, Object> = {
        'success': true,
        'fileName': safeName,
        'filePath': `${dir}/${safeName}（已弹出分享，可选「保存到文件」导出）`
      };
      return JSON.stringify(r);
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'saveBackupFile 失败: %{public}s', JSON.stringify(e));
      return failJson(`${JSON.stringify(e)}`);
    }
  }

  /** 列出备份文件（修改时间倒序，最多 20 个 .json —— 对齐安卓） */
  private listBackupFiles(): string {
    try {
      const dir: string = this.getBackupDir();
      const names: string[] = listFilesSafe(dir);
      const files: Array<Record<string, Object>> = [];
      const sorted: string[] = names.sort((a: string, b: string): number => {
        return fs.statSync(`${dir}/${b}`).mtime - fs.statSync(`${dir}/${a}`).mtime;
      });
      for (const name of sorted) {
        if (files.length >= 20) {
          break;
        }
        if (!name.endsWith('.json')) {
          continue;
        }
        const st: fs.Stat = fs.statSync(`${dir}/${name}`);
        const f: Record<string, Object> = {
          'fileName': name,
          'lastModified': st.mtime,
          'size': st.size
        };
        files.push(f);
      }
      const r: Record<string, Object> = {
        'success': true,
        'files': files as Object
      };
      return JSON.stringify(r);
    } catch (e) {
      return failJson(`${JSON.stringify(e)}`);
    }
  }

  /** 读取备份文件（白名单：backups 目录内 + .json —— 对齐安卓） */
  private readBackupFile(fileName: string): string {
    try {
      const safeName: string = sanitize(fileName);
      if (!safeName.endsWith('.json') || safeName.includes('/')) {
        return failJson('非法备份文件名');
      }
      const path: string = `${this.getBackupDir()}/${safeName}`;
      if (!fs.accessSync(path)) {
        return failJson(`备份文件不存在: ${safeName}`);
      }
      const content: string = readTextFile(path);
      const r: Record<string, Object> = {
        'success': true,
        'json': content
      };
      return JSON.stringify(r);
    } catch (e) {
      return failJson(`${JSON.stringify(e)}`);
    }
  }

  /** 媒体备份：沙箱媒体 → 沙箱媒体备份副本（跳过同名同大小，对齐安卓语义） */
  private backupMedia(): string {
    try {
      let copied: number = 0;
      let skipped: number = 0;
      let totalBytes: number = 0;
      const mediaDir: string = this.getMediaDir();
      const backupDir: string = this.getMediaBackupDir();
      const monthDirs: string[] = listFilesSafe(mediaDir);
      for (const month of monthDirs) {
        const monthPath: string = `${mediaDir}/${month}`;
        if (!fs.statSync(monthPath).isDirectory()) {
          continue;
        }
        ensureDir(`${backupDir}/${month}`);
        const files: string[] = listFilesSafe(monthPath);
        for (const name of files) {
          const src: string = `${monthPath}/${name}`;
          if (!fs.statSync(src).isFile()) {
            continue;
          }
          const dst: string = `${backupDir}/${month}/${name}`;
          const size: number = fs.statSync(src).size;
          if (fs.accessSync(dst) && fs.statSync(dst).size === size) {
            skipped++;
            continue;
          }
          fs.copyFileSync(src, dst);
          copied++;
          totalBytes += size;
        }
      }
      const r: Record<string, Object> = {
        'success': true,
        'copied': copied,
        'skipped': skipped,
        'totalBytes': totalBytes
      };
      return JSON.stringify(r);
    } catch (e) {
      return failJson(`${JSON.stringify(e)}`);
    }
  }

  /** 媒体恢复：沙箱媒体备份副本 → 沙箱媒体目录（按月份还原，跳过同名同大小） */
  private restoreMedia(): string {
    try {
      let restored: number = 0;
      let skipped: number = 0;
      const backupDir: string = this.getMediaBackupDir();
      const mediaDir: string = this.getMediaDir();
      const monthDirs: string[] = listFilesSafe(backupDir);
      for (const month of monthDirs) {
        const monthPath: string = `${backupDir}/${month}`;
        if (!fs.statSync(monthPath).isDirectory()) {
          continue;
        }
        ensureDir(`${mediaDir}/${month}`);
        const files: string[] = listFilesSafe(monthPath);
        for (const name of files) {
          const src: string = `${monthPath}/${name}`;
          if (!fs.statSync(src).isFile()) {
            continue;
          }
          const dst: string = `${mediaDir}/${month}/${name}`;
          const size: number = fs.statSync(src).size;
          if (fs.accessSync(dst) && fs.statSync(dst).size === size) {
            skipped++;
            continue;
          }
          fs.copyFileSync(src, dst);
          restored++;
        }
      }
      const r: Record<string, Object> = {
        'success': true,
        'restored': restored,
        'skipped': skipped
      };
      return JSON.stringify(r);
    } catch (e) {
      return failJson(`${JSON.stringify(e)}`);
    }
  }

  // ==================================================================
  // 媒体查找/统计
  // ==================================================================

  private getMediaStats(): string {
    try {
      let count: number = 0;
      let totalBytes: number = 0;
      const mediaDir: string = this.getMediaDir();
      const monthDirs: string[] = listFilesSafe(mediaDir);
      for (const month of monthDirs) {
        const monthPath: string = `${mediaDir}/${month}`;
        if (fs.statSync(monthPath).isDirectory()) {
          const files: string[] = listFilesSafe(monthPath);
          for (const name of files) {
            const p: string = `${monthPath}/${name}`;
            if (fs.statSync(p).isFile()) {
              count++;
              totalBytes += fs.statSync(p).size;
            }
          }
        } else {
          count++;
          totalBytes += fs.statSync(monthPath).size;
        }
      }
      const backCount: number = countFilesRecursive(this.getMediaBackupDir());
      const r: Record<string, Object> = {
        'success': true,
        'count': count,
        'totalBytes': totalBytes,
        'backCount': backCount
      };
      return JSON.stringify(r);
    } catch (e) {
      return failJson(`${JSON.stringify(e)}`);
    }
  }

  /** 按患者姓名/处方编号查找媒体（三重回退策略，对齐安卓 findMediaFiles） */
  private findMediaFiles(patientName: string, prescriptionNo: string, createdAt: string): string {
    try {
      const files: Array<Record<string, Object>> = [];
      const foundPaths: Set<string> = new Set<string>();
      const safeName: string = sanitize(patientName);
      const safeNo: string = sanitize(prescriptionNo);
      const mediaDir: string = this.getMediaDir();
      if (safeName.length === 0) {
        const empty: Record<string, Object> = {
          'success': true,
          'files': files as Object
        };
        return JSON.stringify(empty);
      }
      const prefix1: string = `${safeName}_${safeNo}`;
      const prefix2: string = `${safeNo}_${safeName}`;

      // 主策略：姓名_编号 / 编号_姓名
      scanDirWithPrefixes(mediaDir, prefix1, prefix2, files, foundPaths);

      // 回退1：姓名 + 时间范围
      if (files.length === 0) {
        const range: number[] = parseTimeRange(createdAt);
        scanDirByNameAndTime(mediaDir, safeName, range[0], range[1], files, foundPaths);
      }
      // 回退2：仅处方编号（不限时间）
      if (files.length === 0 && safeNo.length > 0) {
        scanDirByNameOnly(mediaDir, safeNo, files, foundPaths);
      }
      // 回退3：仅患者姓名（不限时间）
      if (files.length === 0) {
        scanDirByNameOnly(mediaDir, safeName, files, foundPaths);
      }
      const r: Record<string, Object> = {
        'success': true,
        'files': files as Object
      };
      return JSON.stringify(r);
    } catch (e) {
      return failJson(`查找处方文件失败: ${JSON.stringify(e)}`);
    }
  }

  /** 重命名媒体文件（姓名/编号变更时绑定，两种命名格式，对齐安卓） */
  private renameMediaFiles(oldPatientName: string, newPatientName: string, oldNo: string, newNo: string): string {
    try {
      const safeOldName: string = sanitize(oldPatientName);
      const safeNewName: string = sanitize(newPatientName);
      const safeOldNo: string = sanitize(oldNo);
      const safeNewNo: string = sanitize(newNo);
      if (safeOldName.length === 0 || safeNewName.length === 0
        || safeOldNo.length === 0 || safeNewNo.length === 0) {
        return failJson('参数不完整');
      }
      const oldPrefixes: string[] = [`${safeOldName}_${safeOldNo}`, `${safeOldNo}_${safeOldName}`];
      const newPrefixes: string[] = [`${safeNewName}_${safeNewNo}`, `${safeNewNo}_${safeNewName}`];
      const renamedFiles: Array<Record<string, Object>> = [];
      let renamed: number = 0;
      const mediaDir: string = this.getMediaDir();
      for (let i: number = 0; i < oldPrefixes.length; i++) {
        renamed += renameFilesInDir(mediaDir, oldPrefixes[i], newPrefixes[i], renamedFiles);
      }
      const r: Record<string, Object> = {
        'success': true,
        'renamed': renamed,
        'files': renamedFiles as Object
      };
      return JSON.stringify(r);
    } catch (e) {
      return failJson(`重命名文件失败: ${JSON.stringify(e)}`);
    }
  }

  // ==================================================================
  // 文件操作（路径白名单）
  // ==================================================================

  /** 打开媒体文件（viewData + 临时读授权；系统应用按 mime 打开预览） */
  private openFile(filePath: string, mimeType: string): string {
    try {
      if (!fs.accessSync(filePath)) {
        return failJson(`文件不存在: ${filePath}`);
      }
      if (!this.isMediaPathAllowed(filePath)) {
        return failJson('路径不在允许的目录内');
      }
      let mime: string = mimeType;
      if (mime.length === 0) {
        mime = mimeForFile(filePath);
      }
      const uri: string = fileUri.getUriFromPath(filePath);
      const want: Want = {
        action: 'ohos.want.action.viewData',
        uri: uri,
        type: mime === '*/*' ? 'application/octet-stream' : mime,
        flags: 0x00000001
      };
      setTimeout(() => {
        this.context.startAbility(want).catch((err: Object) => {
          hilog.warn(DOMAIN, TAG, '[openFile] 打开失败: %{public}s', JSON.stringify(err));
        });
      }, 0);
      return okJson('');
    } catch (e) {
      return failJson(`打开文件失败: ${JSON.stringify(e)}`);
    }
  }

  /** 整文件读取转 base64 data URL（敏感操作：invoke 入口已做 P1-6 来源校验） */
  private readFileAsBase64(filePath: string): string {
    try {
      if (!fs.accessSync(filePath)) {
        return failJson(`文件不存在: ${filePath}`);
      }
      if (!this.isMediaPathAllowed(filePath)) {
        return failJson('路径不在允许的目录内');
      }
      const size: number = fs.statSync(filePath).size;
      const buf: ArrayBuffer = new ArrayBuffer(size);
      const fd: number = fs.openSync(filePath, fs.OpenMode.READ_ONLY).fd;
      fs.readSync(fd, buf);
      fs.closeSync(fd);
      const bytes: Uint8Array = new Uint8Array(buf);
      const b64: string = this.base64Helper.encodeToStringSync(bytes);
      const mime: string = mimeForFile(filePath);
      const r: Record<string, Object> = {
        'success': true,
        'data': `data:${mime};base64,${b64}`
      };
      return JSON.stringify(r);
    } catch (e) {
      return failJson(`读取文件失败: ${JSON.stringify(e)}`);
    }
  }

  /** 删除文件（敏感操作：invoke 入口已做 P1-6 来源校验 + 路径白名单） */
  private deleteFile(filePath: string): string {
    try {
      if (!fs.accessSync(filePath)) {
        return failJson(`文件不存在: ${filePath}`);
      }
      if (!this.isMediaPathAllowed(filePath)) {
        return failJson('路径不在允许的目录内');
      }
      const st: fs.Stat = fs.statSync(filePath);
      if (st.isDirectory()) {
        return failJson('不能删除目录');
      }
      fs.unlinkSync(filePath);
      hilog.info(DOMAIN, TAG, 'deleteFile 成功: %{public}s', filePath);
      return okJson('');
    } catch (e) {
      return failJson(`删除文件失败: ${JSON.stringify(e)}`);
    }
  }

  // ==================================================================
  // 分片读取会话（每片 256KB，对齐安卓）
  // ==================================================================

  private startReadSession(filePath: string): string {
    let info: ReadSessionInfo = new ReadSessionInfo();
    try {
      if (!fs.accessSync(filePath)) {
        return failJson(`文件不存在: ${filePath}`);
      }
      if (!this.isMediaPathAllowed(filePath)) {
        return failJson('路径不在允许的目录内');
      }
      info.fd = fs.openSync(filePath, fs.OpenMode.READ_ONLY).fd;
      info.fileSize = fs.statSync(filePath).size;
      info.readOffset = 0;
      info.mimeType = mimeForFile(filePath);
      const sessionId: string = `read_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      this.readSessions.set(sessionId, info);
      const r: Record<string, Object> = {
        'success': true,
        'sessionId': sessionId,
        'fileSize': info.fileSize,
        'mimeType': info.mimeType
      };
      return JSON.stringify(r);
    } catch (e) {
      try {
        if (info.fd >= 0) {
          fs.closeSync(info.fd);
        }
      } catch (e2) {
        hilog.warn(DOMAIN, TAG, '关闭 fd 失败: %{public}s', JSON.stringify(e2));
      }
      return failJson(`启动读取会话失败: ${JSON.stringify(e)}`);
    }
  }

  private readNextChunk(sessionId: string): string {
    const info: ReadSessionInfo | undefined = this.readSessions.get(sessionId);
    if (info === undefined || info.fd < 0) {
      return failJson(`无效或已关闭的读取会话: ${sessionId}`);
    }
    try {
      const buf: ArrayBuffer = new ArrayBuffer(READ_CHUNK_SIZE);
      const read: number = fs.readSync(info.fd, buf);
      if (read < 0) {
        const r: Record<string, Object> = {
          'success': true,
          'chunk': '',
          'read': 0,
          'eof': true,
          'offset': info.readOffset,
          'total': info.fileSize
        };
        return JSON.stringify(r);
      }
      // 精确切片（read 可能小于请求长度）
      const actual: Uint8Array = new Uint8Array(buf).slice(0, read);
      const chunkBase64: string = this.base64Helper.encodeToStringSync(actual);
      info.readOffset += read;
      const eof: boolean = info.readOffset >= info.fileSize;
      const r: Record<string, Object> = {
        'success': true,
        'chunk': chunkBase64,
        'read': read,
        'eof': eof,
        'offset': info.readOffset,
        'total': info.fileSize
      };
      return JSON.stringify(r);
    } catch (e) {
      this.closeReadSession(sessionId);
      return failJson(`读取分片失败: ${JSON.stringify(e)}`);
    }
  }

  private closeReadSession(sessionId: string): string {
    const info: ReadSessionInfo | undefined = this.readSessions.get(sessionId);
    this.readSessions.delete(sessionId);
    if (info !== undefined && info.fd >= 0) {
      try {
        fs.closeSync(info.fd);
      } catch (e) {
        hilog.warn(DOMAIN, TAG, 'closeReadSession 关闭失败: %{public}s', JSON.stringify(e));
      }
    }
    return okJson('');
  }

  // ==================================================================
  // 官网付款导引
  // ==================================================================

  /**
   * 官网付款导引：系统浏览器打开官网购买页（严格白名单）。
   * 语义与安卓 openExternalUrl 一致：仅放行 download.html 精确路径或带查询参数（?mid=&ed=）。
   */
  private openExternalUrl(url: string): string {
    const u: string = (url ?? '').trim();
    const allowed: boolean = u === ALLOWED_URL_PREFIX
      || u.startsWith(ALLOWED_URL_PREFIX + '?')
      || u.startsWith(ALLOWED_URL_PREFIX + '#');
    if (!allowed) {
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
    return okJson('');
  }

  // ==================================================================
  // 安全校验（P1-6，对齐安卓 isCallerAllowed/isMediaPathAllowed）
  // ==================================================================

  /** 调用来源校验：当前 Web 页面 host 必须为云端域名 */
  private isCallerAllowed(): boolean {
    try {
      const url: string = this.controller.getUrl();
      if (!url) {
        return false;
      }
      const m: RegExpExecArray | null = /^https:\/\/([^/?#:]+)/i.exec(url);
      if (!m) {
        return false;
      }
      return m[1].toLowerCase() === CLOUD_HOST;
    } catch (e) {
      return false;
    }
  }

  /** 路径白名单：文件必须在媒体目录（或其备份副本目录）内，防沙箱任意文件读写 */
  private isMediaPathAllowed(filePath: string): boolean {
    try {
      if (!filePath || filePath.length === 0) {
        return false;
      }
      // 规范化（消除 ../ 相对路径）
      const normalized: string = normalizePath(filePath);
      const mediaRoot: string = normalizePath(this.getMediaDir());
      const backupRoot: string = normalizePath(this.getMediaBackupDir());
      if (normalized.startsWith(mediaRoot + '/') || normalized === mediaRoot) {
        return true;
      }
      if (normalized.startsWith(backupRoot + '/') || normalized === backupRoot) {
        return true;
      }
      hilog.warn(DOMAIN, TAG, 'isMediaPathAllowed 拒绝非白名单路径: %{public}s', normalized);
      return false;
    } catch (e) {
      return false;
    }
  }
}

// ==================================================================
// 模块级工具函数
// ==================================================================

function okJson(message: string): string {
  const r: Record<string, Object> = { 'success': true };
  if (message.length > 0) {
    r['message'] = message;
  }
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

function optInt(args: Record<string, Object>, key: string): number {
  const v: Object | undefined = args[key];
  if (typeof v === 'number') {
    return v as number;
  }
  return 0;
}

/** 递归建目录（已存在不报错） */
function ensureDir(path: string): void {
  try {
    fs.mkdirSync(path, true);
  } catch (e) {
    // 已存在时 mkdirSync 抛异常，忽略
  }
}

/** 列目录（不存在/失败返回空数组，不抛异常） */
function listFilesSafe(path: string): string[] {
  try {
    return fs.listFileSync(path);
  } catch (e) {
    return [];
  }
}

/** 读取文本文件（UTF-8） */
function readTextFile(path: string): string {
  const size: number = fs.statSync(path).size;
  const buf: ArrayBuffer = new ArrayBuffer(size);
  const fd: number = fs.openSync(path, fs.OpenMode.READ_ONLY).fd;
  fs.readSync(fd, buf);
  fs.closeSync(fd);
  const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
  return decoder.decodeToString(new Uint8Array(buf));
}

/** 文件名清洗（对齐安卓 sanitize：替换非法字符 + trim） */
function sanitize(name: string): string {
  if (!name) {
    return '';
  }
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

/** 当前月份文件夹名 YYYY-MM（对齐安卓 getCurrentMonthFolder） */
function getCurrentMonthFolder(): string {
  const d: Date = new Date();
  const month: number = d.getMonth() + 1;
  return `${d.getFullYear()}-${month < 10 ? '0' + month : String(month)}`;
}

/** 时间戳格式化 yyyyMMdd-HHmmss（打印任务名用，对齐安卓） */
function formatTime(d: Date): string {
  const p2: (n: number) => string = (n: number): string => n < 10 ? '0' + n : String(n);
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

/** 按扩展名推断 MIME（对齐安卓 mimeForFile） */
function mimeForFile(name: string): string {
  const lower: string = name.toLowerCase();
  if (lower.endsWith('.mp4')) {
    return 'video/mp4';
  }
  if (lower.endsWith('.webm')) {
    return 'video/webm';
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  return 'application/octet-stream';
}

/** 路径规范化：消除 ./ 与 ../（对齐安卓 canonicalPath 语义） */
function normalizePath(path: string): string {
  const parts: string[] = path.replace(/\\/g, '/').split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
    stack.push(part);
  }
  return '/' + stack.join('/');
}

/** 递归统计文件数（对齐安卓 countFilesRecursive） */
function countFilesRecursive(dir: string): number {
  let n: number = 0;
  const children: string[] = listFilesSafe(dir);
  for (const child of children) {
    const p: string = `${dir}/${child}`;
    const st: fs.Stat = fs.statSync(p);
    if (st.isDirectory()) {
      n += countFilesRecursive(p);
    } else if (st.isFile()) {
      n++;
    }
  }
  return n;
}

/** 解析 createdAt 为 [start, end] 毫秒时间戳（当天 ±1 天，对齐安卓 parseTimeRange） */
function parseTimeRange(createdAt: string): number[] {
  try {
    if (!createdAt || createdAt.length === 0) {
      const now: number = Date.now();
      return [now - 30 * 24 * 60 * 60 * 1000, now + 24 * 60 * 60 * 1000];
    }
    const dateStr: string = createdAt.trim().replace('T', ' ').split('.')[0].replace('Z', '');
    const parts: string[] = dateStr.split(/[- :]/);
    const date: Date = new Date(
      parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]),
      parts.length > 3 ? parseInt(parts[3]) : 0,
      parts.length > 4 ? parseInt(parts[4]) : 0,
      parts.length > 5 ? parseInt(parts[5]) : 0);
    const time: number = date.getTime();
    return [time - 24 * 60 * 60 * 1000, time + 48 * 60 * 60 * 1000];
  } catch (e) {
    const now: number = Date.now();
    return [now - 7 * 24 * 60 * 60 * 1000, now + 7 * 24 * 60 * 60 * 1000];
  }
}

/** 按双前缀递归扫描（对齐安卓 scanDirForMediaWithPrefixes） */
function scanDirWithPrefixes(dir: string, prefix1: string, prefix2: string,
  files: Array<Record<string, Object>>, foundPaths: Set<string>): void {
  const children: string[] = listFilesSafe(dir);
  for (const child of children) {
    const p: string = `${dir}/${child}`;
    const st: fs.Stat = fs.statSync(p);
    if (st.isDirectory()) {
      scanDirWithPrefixes(p, prefix1, prefix2, files, foundPaths);
      continue;
    }
    if (child.includes(prefix1) || child.includes(prefix2)) {
      if (foundPaths.has(p)) {
        continue;
      }
      foundPaths.add(p);
      const f: Record<string, Object> = {
        'name': child,
        'path': p,
        'type': child.endsWith('.webm') || child.endsWith('.mp4') ? 'video' : 'image',
        'size': st.size,
        'lastModified': st.mtime
      };
      files.push(f);
    }
  }
}

/** 按姓名 + 时间范围递归扫描（对齐安卓 scanDirForMediaByNameAndTime） */
function scanDirByNameAndTime(dir: string, patientName: string, startTime: number, endTime: number,
  files: Array<Record<string, Object>>, foundPaths: Set<string>): void {
  const children: string[] = listFilesSafe(dir);
  for (const child of children) {
    const p: string = `${dir}/${child}`;
    const st: fs.Stat = fs.statSync(p);
    if (st.isDirectory()) {
      scanDirByNameAndTime(p, patientName, startTime, endTime, files, foundPaths);
      continue;
    }
    if (!child.includes(patientName)) {
      continue;
    }
    if (st.mtime < startTime || st.mtime > endTime) {
      continue;
    }
    if (foundPaths.has(p)) {
      continue;
    }
    foundPaths.add(p);
    const f: Record<string, Object> = {
      'name': child,
      'path': p,
      'type': child.endsWith('.webm') || child.endsWith('.mp4') ? 'video' : 'image',
      'size': st.size,
      'lastModified': st.mtime
    };
    files.push(f);
  }
}

/** 仅按关键词递归扫描（对齐安卓 scanDirForMediaByNameOnly） */
function scanDirByNameOnly(dir: string, keyword: string,
  files: Array<Record<string, Object>>, foundPaths: Set<string>): void {
  if (!keyword || keyword.length === 0) {
    return;
  }
  const children: string[] = listFilesSafe(dir);
  for (const child of children) {
    const p: string = `${dir}/${child}`;
    const st: fs.Stat = fs.statSync(p);
    if (st.isDirectory()) {
      scanDirByNameOnly(p, keyword, files, foundPaths);
      continue;
    }
    if (!child.includes(keyword)) {
      continue;
    }
    if (foundPaths.has(p)) {
      continue;
    }
    foundPaths.add(p);
    const f: Record<string, Object> = {
      'name': child,
      'path': p,
      'type': child.endsWith('.webm') || child.endsWith('.mp4') ? 'video' : 'image',
      'size': st.size,
      'lastModified': st.mtime
    };
    files.push(f);
  }
}

/** 目录内按前缀重命名（对齐安卓 renameFilesInDir） */
function renameFilesInDir(dir: string, oldPrefix: string, newPrefix: string,
  renamedFiles: Array<Record<string, Object>>): number {
  let count: number = 0;
  const children: string[] = listFilesSafe(dir);
  for (const child of children) {
    const p: string = `${dir}/${child}`;
    const st: fs.Stat = fs.statSync(p);
    if (st.isDirectory()) {
      count += renameFilesInDir(p, oldPrefix, newPrefix, renamedFiles);
      continue;
    }
    if (child.includes(oldPrefix)) {
      const newName: string = child.replace(oldPrefix, newPrefix);
      const newPath: string = `${dir}/${newName}`;
      try {
        fs.renameSync(p, newPath);
        count++;
        const f: Record<string, Object> = {
          'oldName': child,
          'newName': newName,
          'path': newPath
        };
        renamedFiles.push(f);
      } catch (e) {
        hilog.warn(DOMAIN, TAG, '重命名失败: %{public}s', JSON.stringify(e));
      }
    }
  }
  return count;
}
