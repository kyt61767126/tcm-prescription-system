// 对齐 index.html 的 ?debug 策略：
// - error/warn 始终输出（错误与降级需可见，便于排查）
// - log/info/debug 仅开发环境或 URL 含 ?debug 时输出
const isDev = import.meta.env.DEV;
const isDebug = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('debug');
const verbose = isDev || isDebug;

const noop = () => {};

export const logger = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: verbose ? console.info.bind(console) : noop,
  log: verbose ? console.log.bind(console) : noop,
  debug: verbose ? console.debug.bind(console) : noop,
};
