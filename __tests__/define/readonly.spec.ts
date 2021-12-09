import {
  reactive,
  readonly,
  toRaw,
  isReactive,
  isReadonly,
  markRaw,
  effect,
  ref,
  isProxy,
  computed,
} from '../../src'
import { set, del } from '../../src/defObserver'
import { disableProxy, resetProxy } from '../../src/supportProxy'

beforeEach(() => {
  disableProxy()
})

afterEach(() => {
  resetProxy()
})

/**
 * @see https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html
 */
type Writable<T> = { -readonly [P in keyof T]: T[P] }

describe('reactivity/readonly', () => {
  describe('Object', () => {
    it('should make nested values readonly', () => {
      const original = { foo: 1, bar: { baz: 2 } }
      const wrapped = readonly(original)
      expect(wrapped).not.toBe(original)
      expect(isProxy(wrapped)).toBe(true)
      expect(isReactive(wrapped)).toBe(false)
      expect(isReadonly(wrapped)).toBe(true)
      expect(isReactive(original)).toBe(false)
      expect(isReadonly(original)).toBe(false)
      expect(isReactive(wrapped.bar)).toBe(false)
      expect(isReadonly(wrapped.bar)).toBe(true)
      expect(isReactive(original.bar)).toBe(false)
      expect(isReadonly(original.bar)).toBe(false)
      // get
      expect(wrapped.foo).toBe(1)
      // has
      expect('foo' in wrapped).toBe(true)
      // ownKeys
      expect(Object.keys(wrapped)).toEqual(['foo', 'bar'])
    })

    it('should not allow mutation', () => {
      const original = {
        foo: 1,
        bar: {
          baz: 2,
        },
      }
      const wrapped: Writable<typeof original> = readonly(original)

      wrapped.foo = 2
      expect(wrapped.foo).toBe(1)
      expect(
        `Set operation on key "foo" failed: target is readonly.`
      ).toHaveBeenWarnedLast()

      wrapped.bar.baz = 3
      expect(wrapped.bar.baz).toBe(2)
      expect(
        `Set operation on key "baz" failed: target is readonly.`
      ).toHaveBeenWarnedLast()

      del(wrapped, 'foo')
      expect(wrapped.foo).toBe(1)
      expect(
        `Delete operation on key "foo" failed: target is readonly.`
      ).toHaveBeenWarnedLast()

      del(wrapped.bar, 'baz')
      expect(wrapped.bar.baz).toBe(2)
      expect(
        `Delete operation on key "baz" failed: target is readonly.`
      ).toHaveBeenWarnedLast()
    })

    it('should not trigger effects', () => {
      const wrapped: any = readonly({ a: 1 })
      let dummy
      effect(() => {
        dummy = wrapped.a
      })
      expect(dummy).toBe(1)
      wrapped.a = 2
      expect(wrapped.a).toBe(1)
      expect(dummy).toBe(1)
      expect(`target is readonly`).toHaveBeenWarned()
    })
  })

  describe('Array', () => {
    it('should make nested values readonly', () => {
      const original = [{ foo: 1 }]
      const wrapped = readonly(original)
      expect(wrapped).not.toBe(original)
      expect(isProxy(wrapped)).toBe(true)
      expect(isReactive(wrapped)).toBe(false)
      expect(isReadonly(wrapped)).toBe(true)
      expect(isReactive(original)).toBe(false)
      expect(isReadonly(original)).toBe(false)
      expect(isReactive(wrapped[0])).toBe(false)
      expect(isReadonly(wrapped[0])).toBe(true)
      expect(isReactive(original[0])).toBe(false)
      expect(isReadonly(original[0])).toBe(false)
      // get
      expect(wrapped[0].foo).toBe(1)
      // has
      expect(0 in wrapped).toBe(true)
      // ownKeys
      expect(Object.keys(wrapped)).toEqual(['0'])
    })

    it('should not allow mutation', () => {
      const wrapped: any = readonly([{ foo: 1 }])
      wrapped[0] = 1
      expect(wrapped[0]).not.toBe(1)
      expect(
        `Set operation on key "0" failed: target is readonly.`
      ).toHaveBeenWarned()
      wrapped[0].foo = 2
      expect(wrapped[0].foo).toBe(1)
      expect(
        `Set operation on key "foo" failed: target is readonly.`
      ).toHaveBeenWarned()

      // should block length mutation
      set(wrapped, 'length', 0)
      expect(wrapped.length).toBe(1)
      expect(wrapped[0].foo).toBe(1)
      expect(
        `Set operation on key "length" failed: target is readonly.`
      ).toHaveBeenWarned()

      // mutation methods invoke set/length internally and thus are blocked as well
      wrapped.push(2)
      expect(wrapped.length).toBe(1)
      // push triggers two warnings .length
      expect(`target is readonly.`).toHaveBeenWarnedTimes(4)
    })

    it('should not trigger effects', () => {
      const wrapped: any = readonly([{ a: 1 }])
      let dummy
      effect(() => {
        dummy = wrapped[0].a
      })
      expect(dummy).toBe(1)
      wrapped[0].a = 2
      expect(wrapped[0].a).toBe(1)
      expect(dummy).toBe(1)
      expect(`target is readonly`).toHaveBeenWarnedTimes(1)
      wrapped[0] = { a: 2 }
      expect(wrapped[0].a).toBe(1)
      expect(dummy).toBe(1)
      expect(`target is readonly`).toHaveBeenWarnedTimes(2)
    })
  })

  test('calling reactive on an readonly should return readonly', () => {
    const a = readonly({})
    const b = reactive(a)
    expect(isReadonly(b)).toBe(true)
    // should point to same original
    expect(toRaw(a)).toBe(toRaw(b))
  })

  test('calling readonly on a reactive object should return readonly', () => {
    const a = reactive({})
    const b = readonly(a)
    expect(isReadonly(b)).toBe(true)
    // should point to same original
    expect(toRaw(a)).toBe(toRaw(b))
  })

  test('readonly should track and trigger if wrapping reactive original', () => {
    const a = reactive({ n: 1 })
    const b = readonly(a)
    // should return true since it's wrapping a reactive source
    expect(isReactive(b)).toBe(true)

    let dummy
    effect(() => {
      dummy = b.n
    })
    expect(dummy).toBe(1)
    a.n++
    expect(b.n).toBe(2)
    expect(dummy).toBe(2)
  })

  test('readonly array should not track', () => {
    const arr = [1]
    const roArr = readonly(arr)

    const eff = effect(() => {
      roArr.includes(2)
    })
    expect(eff.effect.deps.length).toBe(0)
  })

  test('wrapping already wrapped value should return same Proxy', () => {
    const original = { foo: 1 }
    const wrapped = readonly(original)
    const wrapped2 = readonly(wrapped)
    expect(wrapped2).toBe(wrapped)
  })

  test('wrapping the same value multiple times should return same Proxy', () => {
    const original = { foo: 1 }
    const wrapped = readonly(original)
    const wrapped2 = readonly(original)
    expect(wrapped2).toBe(wrapped)
  })

  test('markRaw', () => {
    const obj = readonly({
      foo: { a: 1 },
      bar: markRaw({ b: 2 }),
    })
    expect(isReadonly(obj.foo)).toBe(true)
    expect(isReactive(obj.bar)).toBe(false)
  })

  test('should make ref readonly', () => {
    const n: any = readonly(ref(1))
    n.value = 2
    expect(n.value).toBe(1)
    expect(
      `Set operation on key "value" failed: target is readonly.`
    ).toHaveBeenWarned()
  })

  // https://github.com/vuejs/vue-next/issues/3376
  test('calling readonly on computed should allow computed to set its private properties', () => {
    const r = ref<boolean>(false)
    const c = computed(() => r.value)
    const rC = readonly(c)

    r.value = true

    expect(rC.value).toBe(true)
    expect(
      'Set operation on key "_dirty" failed: target is readonly.'
    ).not.toHaveBeenWarned()

    set(rC, 'randomProperty', true)
    expect(
      'Set operation on key "randomProperty" failed: target is readonly.'
    ).toHaveBeenWarned()
  })
})
