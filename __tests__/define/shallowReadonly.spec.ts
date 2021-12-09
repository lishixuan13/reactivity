import { isReactive, isReadonly, readonly, shallowReadonly } from '../../src'
import { disableProxy, resetProxy } from '../../src/supportProxy'

beforeEach(() => {
  disableProxy()
})

afterEach(() => {
  resetProxy()
})

describe('reactivity/shallowReadonly', () => {
  test('should not make non-reactive properties reactive', () => {
    const props = shallowReadonly({ n: { foo: 1 } })
    expect(isReactive(props.n)).toBe(false)
  })

  test('should make root level properties readonly', () => {
    const props = shallowReadonly({ n: 1 }) as any
    props.n = 2
    expect(props.n).toBe(1)
    expect(
      `Set operation on key "n" failed: target is readonly.`
    ).toHaveBeenWarned()
  })

  // to retain 2.x behavior.
  test('should NOT make nested properties readonly', () => {
    const props = shallowReadonly({ n: { foo: 1 } })
    props.n.foo = 2
    expect(props.n.foo).toBe(2)
    expect(
      `Set operation on key "foo" failed: target is readonly.`
    ).not.toHaveBeenWarned()
  })

  // #2843
  test('should differentiate from normal readonly calls', () => {
    const original = { foo: {} }
    const shallowProxy = shallowReadonly(original)
    const reactiveProxy = readonly(original)
    expect(shallowProxy).not.toBe(reactiveProxy)
    expect(isReadonly(shallowProxy.foo)).toBe(false)
    expect(isReadonly(reactiveProxy.foo)).toBe(true)
  })
})
