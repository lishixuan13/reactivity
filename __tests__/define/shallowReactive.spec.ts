import { isReactive, reactive, shallowReactive } from '../../src/reactive'

import { effect } from '../../src/effect'
import { get, ownKeys } from '../../src/defObserver'
import { disableProxy, resetProxy } from '../../src/supportProxy'

beforeEach(() => {
  disableProxy()
})

afterEach(() => {
  resetProxy()
})

describe('shallowReactive', () => {
  test('should not make non-reactive properties reactive', () => {
    const props = shallowReactive({ n: { foo: 1 } })
    expect(isReactive(props.n)).toBe(false)
  })

  test('should keep reactive properties reactive', () => {
    const props: any = shallowReactive({ n: reactive({ foo: 1 }) })
    props.n = reactive({ foo: 2 })
    expect(isReactive(props.n)).toBe(true)
  })

  // #2843
  test('should allow shallow and normal reactive for same target', () => {
    const original = { foo: {} }
    const shallowProxy = shallowReactive(original)
    const reactiveProxy = reactive(original)
    expect(shallowProxy).not.toBe(reactiveProxy)
    expect(isReactive(shallowProxy.foo)).toBe(false)
    expect(isReactive(reactiveProxy.foo)).toBe(true)
  })

  describe('array', () => {
    test('should be reactive', () => {
      const shallowArray = shallowReactive<unknown[]>([])
      const a = {}
      let size

      effect(() => {
        size = get(shallowArray, 'length')
      })

      expect(size).toBe(0)

      shallowArray.push(a)
      expect(size).toBe(1)

      shallowArray.pop()
      expect(size).toBe(0)
    })
    test('should not observe when iterating', () => {
      const shallowArray = shallowReactive<object[]>([])
      const a = {}
      shallowArray.push(a)

      const spreadA = [...shallowArray][0]
      expect(isReactive(spreadA)).toBe(false)
    })

    test('onTrack on called on objectSpread', () => {
      const onTrackFn = jest.fn()
      const shallowArray = shallowReactive([])
      let a
      effect(
        () => {
          a = Array.from(ownKeys(shallowArray))
        },
        {
          onTrack: onTrackFn,
        }
      )

      expect(a).toMatchObject([])
      expect(onTrackFn).toHaveBeenCalled()
    })
  })
})
