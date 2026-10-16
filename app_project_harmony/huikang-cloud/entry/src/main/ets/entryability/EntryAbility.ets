import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { emitter } from '@kit.BasicServicesKit';
import { BNZC_EMIT_EVENT_ID, BNZC_PENDING_KEY, appendBnzcDebug } from '../bridge/NativeBridge';

const DOMAIN: number = 0x0000;
const TAG: string = 'HuikangCloud';

/**
 * 形如 code=xxx&t=yyy 的 query 串取参（对齐安卓 Uri.getQueryParameter 的 URL decode 语义）。
 * 键名精确匹配首个命中项；值 decode 失败返回空串（不抛异常）。
 */
function getQueryParam(query: string, key: string): string {
  const pairs: string[] = query.split('&');
  for (const p of pairs) {
    const idx: number = p.indexOf('=');
    if (idx > 0 && p.substring(0, idx) === key) {
      try {
        return decodeURIComponent(p.substring(idx + 1));
      } catch (e) {
        return '';
      }
    }
  }
  return '';
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'Ability onCreate');
    // ★ 2026-10-16 一键激活 P0：冷启动 bnzc:// 深链接收口（只暂存，
    //   由页面 JS 启动后经 bnzcGetPending 桥主动拉取）。
    this.handleBnzcDeepLink(want, false);
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, 'Ability onDestroy');
  }

  /**
   * ★ 2026-10-16 一键激活 P0：App 运行中点击 bnzc:// 链接（singleton 复用实例，
   * 不新建）→ 暂存 + emitter 通知 Index 直推渲染层；页面未就绪时由 JS 拉取兜底。
   */
  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'Ability onNewWant');
    this.handleBnzcDeepLink(want, true);
  }

  /**
   * bnzc://activate?code=裸码 或 ?t=一次性令牌 深链收口（对齐安卓云 App
   * parseBnzcDeepLink 同语义：code/t 二选一 code 优先、code 大写化、
   * 兼容 bnzc://activate 与 bnzc://activate/）。解析结果暂存 AppStorage。
   */
  private handleBnzcDeepLink(want: Want, dispatch: boolean): void {
    const json: string = this.parseBnzcDeepLink(want);
    if (json.length === 0) {
      return;
    }
    AppStorage.setOrCreate(BNZC_PENDING_KEY, json);
    // 诊断日志脱敏：只写 code 或 token 前 8 位（对齐安卓 appendBnzcDebug 口径）
    let brief: string = '';
    try {
      const o: Record<string, Object> = JSON.parse(json) as Record<string, Object>;
      const c: Object | undefined = o['code'];
      const t: Object | undefined = o['token'];
      if (typeof c === 'string' && c.length > 0) {
        brief = c;
      } else if (typeof t === 'string' && t.length > 0) {
        brief = 'token:' + t.substring(0, Math.min(8, t.length));
      }
    } catch (e) {
      brief = '(brief 解析失败)';
    }
    appendBnzcDebug(this.context, 'deep-link captured: ' + brief);
    if (dispatch) {
      const payload: Record<string, Object> = { 'json': json };
      emitter.emit({ eventId: BNZC_EMIT_EVENT_ID }, { data: payload });
    }
  }

  /** 解析 want.uri，非法/无有效参数返回空串 */
  private parseBnzcDeepLink(want: Want): string {
    try {
      const uri: string | undefined = want.uri;
      if (uri === undefined || !uri.startsWith('bnzc://')) {
        return '';
      }
      const rest: string = uri.substring('bnzc://'.length);
      // host 兼容 bnzc://activate 与 bnzc://activate/（对齐安卓 getHost 判定；
      //   host 为空时放行，非 activate 时拒绝）
      let cut: number = rest.length;
      const slash: number = rest.indexOf('/');
      const q: number = rest.indexOf('?');
      if (slash >= 0) {
        cut = Math.min(cut, slash);
      }
      if (q >= 0) {
        cut = Math.min(cut, q);
      }
      const host: string = rest.substring(0, cut);
      if (host.length > 0 && host !== 'activate') {
        return '';
      }
      if (q < 0) {
        return '';
      }
      const query: string = rest.substring(q + 1);
      // code（旧裸码，trim + 大写）/ t（一次性令牌）二选一，code 优先
      const code: string = getQueryParam(query, 'code').trim().toUpperCase();
      const token: string = getQueryParam(query, 't').trim();
      if (code.length === 0 && token.length === 0) {
        return '';
      }
      const j: Record<string, Object> = {};
      if (code.length > 0) {
        j['code'] = code;
      }
      if (token.length > 0) {
        j['token'] = token;
      }
      j['clinicName'] = getQueryParam(query, 'clinic');
      j['user'] = getQueryParam(query, 'user');
      return JSON.stringify(j);
    } catch (e) {
      hilog.warn(DOMAIN, TAG, '[Bnzc] 深链解析失败: %{public}s', JSON.stringify(e));
      return '';
    }
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(DOMAIN, TAG, 'Ability onWindowStageCreate');
    // 全屏加载 Web 页面（pages/Index 内含 Web 组件，加载云端地址）
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'Failed to load content. Cause: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, TAG, 'Succeeded in loading content.');
    });
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, TAG, 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    hilog.info(DOMAIN, TAG, 'Ability onForeground');
  }

  onBackground(): void {
    hilog.info(DOMAIN, TAG, 'Ability onBackground');
  }
}
