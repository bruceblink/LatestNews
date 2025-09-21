import { useBeforeUnload, useMount } from "react-use"

const KEY = "unload-time"
export function isPageReload() {
  const _ = localStorage.getItem(KEY)
  if (!_) return false
  const unloadTime = Number(_)
  if (!Number.isNaN(unloadTime) && Date.now() - unloadTime < 1000) {
    return true
  }
  localStorage.removeItem(KEY)
  return false
}

export function useOnReload(fn?: () => Promise<void> | void, fallback?: () => Promise<void> | void) {
  useBeforeUnload(() => {
    localStorage.setItem(KEY, Date.now().toString())
    return false
  })

  useMount(() => {
    if (isPageReload()) {
      fn?.()
    } else {
      fallback?.()
    }
  })
}
