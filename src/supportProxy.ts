function isNative(Ctor: any): boolean {
  return typeof Ctor === 'function' && /native code/.test(Ctor.toString())
}
const supportProxy = isNative(Proxy)

export let shouldUseProxy = supportProxy

export function disableProxy() {
  shouldUseProxy = false
}

export function enableProxy() {
  shouldUseProxy = true
}

export function resetProxy() {
  shouldUseProxy = supportProxy
}
