// `published` is epoch ms, or null when the feed gave no date.
export type Item = { title: string; outlet: string; published: number | null }

declare module 'claude-code' {
  interface PluginState {
    'news-ticker': { items: Item[]; offset: number }
  }
}
