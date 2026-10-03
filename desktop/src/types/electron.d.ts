export {}

declare global {
  interface Window {
    desktop?: {
      platform: string
      openExternal: (url: string) => Promise<boolean>
    }
  }
}
