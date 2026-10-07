// `id` is the background task id the shell's Bash or PowerShell call returned.
export type Shell = { id: string; title: string }

declare module 'claude-code' {
  interface PluginState {
    'shell-spinners': { shells: Shell[]; frame: number }
  }
}
