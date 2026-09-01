/**
 * 惠康中医云端版主页面（HarmonyOS NEXT · Web 壳）
 * ------------------------------------------------------------------
 * 对齐安卓云端版 MainActivity 的 WebView 行为（2026-09-01 提取）：
 *   - 全屏 Web 加载 https://tcm-prescription-system.pages.dev
 *   - javaScriptProxy 注册 AndroidNative（invoke/printHtml/__exitApp）
 *   - onLoadIntercept 反钓鱼拦截（云端域名白名单 + 官网下载页转系统浏览器）
 *   - onPageBegin/onPageEnd 触发 PageInject 注入序列
 *   - onJsAlert/onJsConfirm/onJsPrompt 原生对话框（含输入框，保留原账号信息）
 *   - onShowFileChooser 文件选择器（恢复数据 importData 链路）
 *   - 主框架网络错误 → 重试对话框；启动加载遮罩（揭幕后不再出现）
 *   - 返回键：有历史则后退，否则退出应用
 */
import { webview } from '@kit.ArkWeb';
import { common, Want } from '@kit.AbilityKit';
import { picker } from '@kit.CoreFileKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { NativeBridge } from '../bridge/NativeBridge';
import { PageInject } from '../bridge/PageInject';

const DOMAIN: number = 0x0000;
const TAG: string = 'HuikangCloudIndex';

/** 云端域名（与安卓 CLOUD_HOST 一致） */
const CLOUD_URL: string = 'https://tcm-prescription-system.pages.dev';
const CLOUD_HOST_PREFIX: string = 'https://tcm-prescription-system.pages.dev';
/** 官网下载页（与安卓 UPDATE_DOWNLOAD_URL 一致，转系统浏览器打开） */
const UPDATE_DOWNLOAD_URL: string = 'https://tcm-prescription-system.pages.dev/download';

function isCloudUrl(url: string): boolean {
  // 与安卓 isCloudUrl 的 host 严格校验语义一致（前缀匹配整段 host）
  return url.startsWith(CLOUD_HOST_PREFIX);
}

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  bridge: NativeBridge = new NativeBridge(getContext(this) as common.UIAbilityContext);
  inject: PageInject = new PageInject(getContext(this) as common.UIAbilityContext, this.controller);

  /** 启动加载遮罩（对齐安卓"揭幕后不再出现"，防三屏闪） */
  @State showLoading: boolean = true;
  private loadingDone: boolean = false;

  /** JS prompt 输入弹窗状态（编辑弹窗自动保留原账号信息） */
  @State showPrompt: boolean = false;
  @State promptMsg: string = '';
  @State promptVal: string = '';
  @State promptInput: string = '';
  private promptConfirm: ((v: string) => void) | null = null;
  private promptCancel: (() => void) | null = null;

  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, 'Index aboutToAppear');
    // 预加载注入脚本（异步，不阻塞页面加载）
    this.inject.preload();
    // 加载遮罩 5 秒超时兜底（对齐安卓 splashTimeoutRunnable）
    setTimeout(() => {
      this.hideLoading();
    }, 5000);
  }

  private hideLoading(): void {
    if (this.loadingDone) {
      return;
    }
    this.loadingDone = true;
    this.showLoading = false;
  }

  private openInBrowser(url: string): void {
    try {
      const ctx = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const want: Want = {
        action: 'ohos.want.action.viewData',
        uri: url
      };
      ctx.startAbility(want).catch((err: Object) => {
        hilog.warn(DOMAIN, TAG, 'openInBrowser 失败: %{public}s', JSON.stringify(err));
      });
    } catch (e) {
      hilog.warn(DOMAIN, TAG, 'openInBrowser 异常: %{public}s', JSON.stringify(e));
    }
  }

  build() {
    Stack() {
      // ---------------- 主 Web ----------------
      Web({ src: CLOUD_URL, controller: this.controller })
        .width('100%')
        .height('100%')
        .domStorageAccess(true)          // localStorage（记住用户名等用户态）
        .databaseAccess(true)
        .fileAccess(false)               // S1 安全：禁本地文件访问（对齐安卓）
        .mixedMode(MixedMode.None)       // 禁混合内容（对齐安卓 MIXED_CONTENT_NEVER_ALLOW）
        .multiWindowAccess(false)
        .javaScriptProxy({
          object: this.bridge,
          name: 'AndroidNative',
          methodList: ['invoke', 'printHtml', '__exitApp'],
          controller: this.controller
        })
        // 反钓鱼拦截（对齐安卓 shouldOverrideUrlLoading）
        .onLoadIntercept((event) => {
          if (!event) {
            return false;
          }
          const url: string = event.data.getRequestUrl();
          if (url === UPDATE_DOWNLOAD_URL) {
            // 更新横幅「立即下载」→ 系统浏览器打开官网下载页（对齐安卓方案A）
            this.openInBrowser(url);
            return true;
          }
          if (isCloudUrl(url)) {
            return false; // 允许加载
          }
          hilog.warn(DOMAIN, TAG, '拦截非云端导航: %{public}s', url);
          return true; // 拦截非云端导航
        })
        .onPageBegin(() => {
          // 对齐安卓 onPageStarted：提前注入 anti-autofill + AndroidAppExit shim
          this.inject.onPageBegin();
        })
        .onPageEnd(() => {
          // 对齐安卓 onPageFinished 注入序列 + 揭幕
          this.inject.onPageEnd();
          this.hideLoading();
        })
        .onConsole((event) => {
          if (event) {
            hilog.info(DOMAIN, TAG, '[web-console] %{public}s', event.message.getMessage());
          }
          return false;
        })
        // 原生 alert 对话框（对齐安卓 onJsAlert）
        .onAlert((event) => {
          if (event) {
            this.getUIContext().showAlertDialog({
              message: event.message,
              primaryButton: {
                value: '确定',
                action: () => event.result.handleConfirm()
              },
              cancel: () => event.result.handleConfirm()
            });
            return true;
          }
          return false;
        })
        // 原生 confirm 对话框（对齐安卓 onJsConfirm）
        .onConfirm((event) => {
          if (event) {
            this.getUIContext().showAlertDialog({
              message: event.message,
              primaryButton: {
                value: '确定',
                action: () => event.result.handleConfirm()
              },
              secondaryButton: {
                value: '取消',
                action: () => event.result.handleCancel()
              },
              cancel: () => event.result.handleCancel()
            });
            return true;
          }
          return false;
        })
        // 原生 prompt 输入弹窗（对齐安卓 onJsPrompt：输入框预填原账号信息并全选）
        .onPrompt((event) => {
          if (event) {
            this.promptMsg = event.message ?? '';
            this.promptVal = event.value ?? '';
            this.promptInput = this.promptVal;
            this.promptConfirm = (v: string) => {
              event.result.handlePromptConfirm(v);
            };
            this.promptCancel = () => {
              event.result.handleCancel();
            };
            this.showPrompt = true;
            return true;
          }
          return false;
        })
        // 文件选择器（对齐安卓 onShowFileChooser：恢复数据 importData 链路）
        .onShowFileSelector((event) => {
          if (!event) {
            return false;
          }
          try {
            const hostCtx = this.getUIContext().getHostContext();
            const docPicker: picker.DocumentViewPicker =
              hostCtx ? new picker.DocumentViewPicker(hostCtx) : new picker.DocumentViewPicker();
            docPicker.select({ maxSelectNumber: 1 }).then((uris: Array<string>) => {
              event.result.handleFileList(uris);
            }).catch(() => {
              event.result.handleFileList([]);
            });
          } catch (e) {
            hilog.warn(DOMAIN, TAG, '文件选择器启动失败: %{public}s', JSON.stringify(e));
            event.result.handleFileList([]);
          }
          return true;
        })
        // 主框架网络错误 → 重试对话框（对齐安卓 showErrorPage，仅主框架）
        .onErrorReceive((event) => {
          if (event && event.request.isMainFrame()) {
            hilog.warn(DOMAIN, TAG, '主框架加载失败: %{public}s', event.request.getRequestUrl());
            this.getUIContext().showAlertDialog({
              message: '网络连接失败，请检查网络后重试',
              primaryButton: {
                value: '重试',
                action: () => {
                  try {
                    this.controller.refresh();
                  } catch (e) {
                    hilog.error(DOMAIN, TAG, 'refresh 失败: %{public}s', JSON.stringify(e));
                  }
                }
              },
              cancel: () => {
              }
            });
          }
        })

      // ---------------- JS prompt 输入弹窗（覆盖层） ----------------
      if (this.showPrompt) {
        Column() {
          Column({ space: 16 }) {
            Text(this.promptMsg)
              .fontSize(16)
              .fontColor('#333333')
              .maxLines(4)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            TextInput({ text: this.promptInput, placeholder: '' })
              .width('100%')
              .height(48)
              .fontSize(16)
              .border({ width: 1, color: '#999999' })  // 用户规范：输入框必须有可见边框
              .borderRadius(6)
              .onChange((value: string) => {
                this.promptInput = value;
              })
            Row({ space: 12 }) {
              Button('取消')
                .layoutWeight(1)
                .fontSize(16)
                .backgroundColor('#F2F3F5')
                .fontColor('#333333')
                .onClick(() => {
                  this.showPrompt = false;
                  if (this.promptCancel !== null) {
                    this.promptCancel();
                  }
                })
              Button('确定')
                .layoutWeight(1)
                .fontSize(16)
                .backgroundColor('#1E6FFF')
                .onClick(() => {
                  this.showPrompt = false;
                  if (this.promptConfirm !== null) {
                    this.promptConfirm(this.promptInput);
                  }
                })
            }
            .width('100%')
          }
          .padding(24)
          .width('82%')
          .borderRadius(12)
          .backgroundColor(Color.White)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          // 点击遮罩 = 取消（对齐安卓 AlertDialog setOnCancelListener）
          this.showPrompt = false;
          if (this.promptCancel !== null) {
            this.promptCancel();
          }
        })
      }

      // ---------------- 启动加载遮罩（揭幕后不再出现） ----------------
      if (this.showLoading) {
        Column({ space: 12 }) {
          LoadingProgress()
            .width(48)
            .height(48)
            .color('#1E6FFF')
          Text('正在连接云端...')
            .fontSize(15)
            .fontColor('#666666')
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor(Color.White)
      }
    }
    .width('100%')
    .height('100%')
  }

  /** 返回键：有历史则页面后退，否则退出应用（对齐安卓返回语义） */
  onBackPress(): boolean {
    try {
      if (this.controller.accessBackward()) {
        this.controller.backward();
        return true;
      }
    } catch (e) {
      hilog.warn(DOMAIN, TAG, 'onBackPress 异常: %{public}s', JSON.stringify(e));
    }
    const ctx = this.getUIContext().getHostContext() as common.UIAbilityContext;
    ctx.terminateSelf();
    return true;
  }
}
