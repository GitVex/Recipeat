export type Strip = string

declare module 'claude-code' {
  interface PluginState {
    'news-ticker': { strip: Strip; offset: number }
  }
}
