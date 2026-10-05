// `published` is epoch ms, or null when the feed gave no date.
export type Item = { key: string; title: string; outlet: string; published: number | null }

declare module 'claude-code' {
  interface PluginState {
    'news-ticker': { items: Item[]; seen: string[]; offset: number }
  }
}
