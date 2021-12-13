import {
  isObject,
  isArray,
  isSymbol,
  hasOwn,
  isIntegerKey,
  isPlainObject,
} from '@vue/shared'
import {
  toRaw,
  isReadonly,
  isProxy,
  Target,
  reactive,
  readonly,
  ReactiveFlags,
  readonlyMap,
  reactiveMap,
  shallowReactiveMap,
  shallowReadonlyMap,
} from './reactive'
import {
  track,
  trigger,
  ITERATE_KEY,
  pauseTracking,
  resetTracking,
} from './effect'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { isRef, unref } from './ref'

/**
 * Define a property.
 */
function def(
  obj: object,
  key: PropertyKey,
  val: any,
  enumerable?: boolean
): void {
  Object.defineProperty(obj, key, {
    value: val,
    enumerable: !!enumerable,
    writable: true,
    configurable: true,
  })
}

function defGet(
  obj: object,
  key: PropertyKey,
  get: () => any,
  enumerable?: boolean
): void {
  Object.defineProperty(obj, key, {
    get: get,
    enumerable: !!enumerable,
    configurable: true,
  })
}

const arrayInstrumentations = /*#__PURE__*/ createArrayInstrumentations()
const readonlyArrayInstrumentations = createReadonlyArrayInstrumentations()

function createReadonlyArrayInstrumentations() {
  const instrumentations: Record<string, Function> = {}
  ;(
    ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'] as const
  ).forEach((key) => {
    instrumentations[key] = function (this: unknown[]) {
      const origin = toRaw(this)
      if (__DEV__) {
        console.warn(
          `Set operation on methods "${String(
            key
          )}" failed: target is readonly.`,
          origin
        )
      }
    }
  })
  return instrumentations
}

let shouldTrigger = true
const triggerStack: boolean[] = []

export function pauseTriggering() {
  triggerStack.push(shouldTrigger)
  shouldTrigger = false
}

export function enableTriggering() {
  triggerStack.push(shouldTrigger)
  shouldTrigger = true
}

export function resetTriggering() {
  const last = triggerStack.pop()
  shouldTrigger = last === undefined ? true : last
}

function createArrayInstrumentations() {
  const instrumentations: Record<string, Function> = {}
  ;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach((key) => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      const arr = toRaw(this) as any
      for (let i = 0, l = this.length; i < l; i++) {
        track(arr, TrackOpTypes.GET, i + '')
      }
      // we run the method using the original args first (which may be reactive)
      const res = arr[key](...args)
      if (res === -1 || res === false) {
        // if that didn't work, run it again using raw values.
        return arr[key](...args.map(toRaw))
      } else {
        return res
      }
    }
  })
  // instrument length-altering mutation methods to avoid length being tracked
  // which leads to infinite loops in some cases (#2137)
  ;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach((key) => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      pauseTracking()
      const origin = toRaw(this) as any
      const oldLen = origin.length
      const changeArray = triggerArrayMethods(args, key, origin)
      enableTriggering()
      const res = origin[key](...args)
      resetTriggering()
      const newLen = origin.length
      // 新增了元素
      if (oldLen !== newLen) {
        if (oldLen < newLen) {
          for (let i = oldLen; i < newLen; i++) {
            defineReactiveByProxy(this, origin, i)
          }
        } else if (oldLen > newLen) {
          for (let i = newLen; i < oldLen; i++) {
            delete this[i]
          }
        }

        this.length = newLen
        trigger(origin, TriggerOpTypes.SET, 'length', newLen, oldLen)

        if (changeArray) {
          changeArray.forEach(({ type, key, oldVal }) => {
            trigger(
              origin,
              type,
              formatIntegerKey(key),
              type === TriggerOpTypes.DELETE ? undefined : origin[key],
              oldVal
            )
          })
        }
      }

      resetTracking()
      return res
    }
  })
  return instrumentations
}

interface ChangeArrayOptions {
  type: TriggerOpTypes
  key: string | number
  oldVal: any
}

function triggerArrayMethods(
  args: any[],
  methods: string,
  origin: any
): ChangeArrayOptions[] {
  let changeArray: ChangeArrayOptions[] = []
  const len = origin.length
  switch (methods) {
    case 'push':
      changeArray = args.map((v, i) => ({
        type: TriggerOpTypes.ADD,
        key: i + len,
        oldVal: undefined,
      }))
      break
    case 'unshift':
      changeArray = rearrange(0, len + 1, len, origin)
      break
    case 'pop':
      changeArray = [
        {
          type: TriggerOpTypes.DELETE,
          key: len - 1,
          oldVal: origin[len - 1],
        },
      ]
    case 'shift':
      changeArray = rearrange(0, len - 1, len - 1, origin)
      break
    case 'splice':
      if (args && (args[1] > 0 || args.length > 2)) {
        let start = args[0] as number
        if (start >= len) {
          start = len
        } else if (start < 0) {
          if (Math.abs(start) > len) {
            start = 0
          } else {
            start = len - start
          }
        }
        // 新的长度等于减去删除的加上新增的
        const end = len - (args[1] as number) + args.length
        changeArray = rearrange(start, end, len, origin)
      }
      break
  }
  return changeArray
}

// 触发数组重新排列 shift unshift splice
function rearrange(
  start: number,
  end: number,
  len: number,
  array: any
): ChangeArrayOptions[] {
  const arr: ChangeArrayOptions[] = []
  if (end > start) {
    for (let i = start; i < end; i++) {
      const isAdd = i >= len
      arr.push({
        type: isAdd ? TriggerOpTypes.ADD : TriggerOpTypes.SET,
        key: i,
        oldVal: isAdd ? undefined : array[i],
      })
    }
  }
  return arr
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
function copyAugment(target: any, src: any): void {
  const keys = Object.keys(src)
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i]
    def(target, key, src[key])
  }
}

export function defProxy(
  value: object,
  isReadonly: boolean,
  shallow: boolean
): object {
  let proxy = Object.create(value)
  const targetIsArray = isArray(value)
  if (targetIsArray) {
    proxy = []
  }
  walk(proxy, value, isReadonly, shallow)

  if (targetIsArray) {
    // 覆盖方法属性
    copyAugment(
      proxy,
      isReadonly ? readonlyArrayInstrumentations : arrayInstrumentations
    )
  }

  if (isRef(value)) {
    defineReactive(proxy, value, 'value', isReadonly, shallow)
  }

  def(proxy, ReactiveFlags.IS_REACTIVE, !isReadonly)
  def(proxy, ReactiveFlags.IS_READONLY, isReadonly)
  def(proxy, ReactiveFlags.IS_DEFINE, true)
  def(proxy, ReactiveFlags.IS_SHALLOW, shallow)
  defGet(proxy, ReactiveFlags.RAW, function () {
    if (
      (isReadonly
        ? shallow
          ? shallowReadonlyMap
          : readonlyMap
        : shallow
        ? shallowReactiveMap
        : reactiveMap
      ).get(value)
    ) {
      return value
    }
  })
  return proxy
}

function walk(
  proxy: object,
  target: object,
  isReadonly: boolean,
  shallow: boolean
): void {
  const keys = Object.keys(target)
  for (let i = 0; i < keys.length; i++) {
    defineReactive(proxy, target, keys[i], isReadonly, shallow)
  }
}

/**
 * Define a reactive property on an Object.
 */
function defineReactive(
  proxy: object,
  target: any,
  key: PropertyKey,
  isReadonly = false,
  shallow = false
): void {
  const property = Object.getOwnPropertyDescriptor(target, key)
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  const getter = property && property.get
  const setter = property && property.set
  Object.defineProperty(proxy, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter() {
      const res = getter ? getter.call(proxy) : target[key]

      if (!isReadonly) {
        track(target, TrackOpTypes.GET, key)
      }

      if (shallow) {
        return res
      }
      const targetIsArray = isArray(target)

      if (isRef(res)) {
        // ref unwrapping - does not apply for Array + integer key.
        const shouldUnwrap = !targetIsArray || !isIntegerKey(key)
        return shouldUnwrap ? res.value : res
      }

      if (isObject(res)) {
        return isReadonly ? readonly(res) : reactive(res)
      }

      return res
    },
    set: function reactiveSetter(value) {
      if (isReadonly) {
        readonlySetWarn(key, target)
        return
      }
      let oldValue = getter ? getter.call(proxy) : target[key]
      if (!shallow) {
        value = toRaw(value)
        oldValue = toRaw(oldValue)
        if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
          oldValue.value = value
          return true
        }
      } else {
        // in shallow mode, objects are set as-is regardless of reactive or not
      }

      if (oldValue === value || (oldValue !== oldValue && value !== value)) {
        return
      }

      if (getter && !setter) {
        return
      }
      if (setter) {
        setter.call(proxy, value)
      } else {
        target[key] = value
      }

      trigger(target, TriggerOpTypes.SET, key, value, oldValue)
    },
  })
}

function isShallow(proxy: Target): boolean {
  return !!(proxy && (proxy as Target)[ReactiveFlags.IS_SHALLOW])
}

function defineReactiveByProxy(proxy: any, target: any, key: any) {
  defineReactive(proxy, target, key, isReadonly(proxy), isShallow(proxy))
}

function findProxyMap(target: any): any {
  if (reactiveMap.has(target)) {
    return reactiveMap.get(target)
  } else if (shallowReactiveMap.has(target)) {
    return shallowReactiveMap.get(target)
  } else if (readonlyMap.has(target)) {
    return readonlyMap.get(target)
  } else if (shallowReadonlyMap.has(target)) {
    return shallowReadonlyMap.get(target)
  }
}

function readonlySetWarn(key: any, target: any): void {
  if (__DEV__) {
    console.warn(
      `Set operation on key "${String(key)}" failed: target is readonly.`,
      target
    )
  }
}

const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map((key) => (Symbol as any)[key])
    .filter(isSymbol)
)

export function has(target: any, key: any): any {
  if (!isObject(target)) {
    warnCannotMethods('has')
    return
  }
  const res = key in target

  pauseTracking()
  const shouldTrack =
    isReactiveDefine(target) &&
    !isReadonly(target) &&
    (!isSymbol(key) || !builtInSymbols.has(key))
  resetTracking()

  if (shouldTrack) {
    track(toRaw(target), TrackOpTypes.HAS, formatIntegerKey(key))
  }
  return res
}

function formatIntegerKey(key: any): any {
  return isIntegerKey(key + '') ? key + '' : key
}

export function isReactiveDefine(target: Target): boolean {
  return !!(target && target[ReactiveFlags.IS_DEFINE])
}

export function ownKeys<T>(target: T): T {
  pauseTracking()
  const shouldTrack = isReactiveDefine(target) && !isReadonly(target)
  resetTracking()

  if (shouldTrack) {
    const origin = toRaw(target)
    track(
      origin as any,
      TrackOpTypes.ITERATE,
      isArray(origin) ? 'length' : ITERATE_KEY
    )
  }
  return target
}

export function get(target: any, key: string | number): any {
  if (!isObject(target)) {
    warnCannotMethods('get')
    return
  }
  if (!isReactiveDefine(target)) {
    return target[key]
  }
  const origin = toRaw(target)
  const res = origin[key]

  const _isReadonly = isReadonly(target)

  if (!_isReadonly) {
    track(origin, TrackOpTypes.GET, formatIntegerKey(key))
  }

  if (isShallow(target)) {
    return res
  }

  const targetIsArray = isArray(origin)

  if (isRef(res)) {
    // ref unwrapping - does not apply for Array + integer key.
    const shouldUnwrap = !targetIsArray || !isIntegerKey(key)
    return shouldUnwrap ? res.value : res
  }

  if (isObject(res)) {
    return _isReadonly ? readonly(res) : reactive(res)
  }
  return res
}

function warnCannotMethods(method: string) {
  if (__DEV__) {
    console.warn(
      `target is not an object type, ${method} function call cannot be made`
    )
  }
}

export function set(target: any, key: string | number, val: any): void {
  if (!isObject(target)) {
    warnCannotMethods('set')
    return
  }

  const isDefine = isReactiveDefine(target)

  if (isProxy(target) && !isDefine) {
    target[key] = val
    return val
  }

  if (key in Object.prototype) return val

  const isArrayLength = isDefine && isArray(target) && key === 'length'

  if (!isArrayLength) {
    // 如果是 length 改变走下面路线
    if (key in target) {
      target[key] = val
      return val
    }
  }

  if (isReadonly(target)) {
    readonlySetWarn(key, target)
    return
  }

  if (!isProxy(target)) {
    const proxy = findProxyMap(target)
    // 原属性的新增，不需要通知
    // 但是如果在数组重写的方法中需要通知
    target[key] = val
    if (proxy) {
      defineReactiveByProxy(proxy, target, key)
    }
    return
  }
  const proxy = target
  const origin = toRaw(target)

  if (!isShallow(proxy)) {
    val = toRaw(val)
  }

  origin[key] = val

  defineReactiveByProxy(proxy, origin, key)
  if (isArrayLength) {
    trigger(origin, TriggerOpTypes.SET, key, val, proxy.length)
    proxy.length = origin.length
  } else {
    trigger(origin, TriggerOpTypes.ADD, formatIntegerKey(key), val)
  }
  if (isArray(origin) && isIntegerKey(key + '')) {
    trigger(origin, TriggerOpTypes.SET, 'length', origin.length, proxy.length)
    proxy.length = origin.length
  }
}

export function del(target: any, key: string | number): void {
  if (!isObject(target)) {
    warnCannotMethods('del')
    return
  }
  if (isProxy(target) && !isReactiveDefine(target)) {
    delete target[key]
    return
  }

  if (isArray(target) && isIntegerKey(key)) {
    target.splice(key as number, 1)
    return
  }
  if (!hasOwn(target, key as string)) {
    return
  }

  if (isReadonly(target) && __DEV__) {
    console.warn(
      `Delete operation on key "${String(key)}" failed: target is readonly.`,
      target
    )
    return
  }

  if (!isProxy(target)) {
    const proxy = findProxyMap(target)
    // 原属性的删除，不需要通知
    // 但是如果在数组重写的方法中需要通知
    delete target[key]
    if (proxy) {
      delete proxy[key]
    }
    return
  }

  const origin = toRaw(target)
  const oldValue = origin[key]
  delete target[key]
  delete origin[key]
  trigger(
    origin,
    TriggerOpTypes.DELETE,
    formatIntegerKey(key),
    undefined,
    oldValue
  )
}

export function defProxyRef<T>(target: T): T {
  // 不支持数组
  if (!isPlainObject(target)) {
    if (__DEV__) {
      console.warn(
        `target cannot be made reactive: ${String(target)}${
          isArray(target) ? '，Does not support arrays' : ''
        }`
      )
    }
    return target
  }
  const proxy = Object.create(target)
  for (const key in target) {
    Object.defineProperty(proxy, key, {
      enumerable: true,
      configurable: true,
      get: function () {
        unref(target[key])
      },
      set: (value) => {
        const oldValue = target[key]
        if (isRef(oldValue) && !isRef(value)) {
          oldValue.value = value
        } else {
          target[key] = value
        }
      },
    })
  }
  return proxy
}
