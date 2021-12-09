# @roundjs/reactivity

## 说明

兼容了 `@vue/reactivity` 在不支持 `Proxy`环境使用的问题

兼容方案不支持`Collections(Set/Map)`、`Symbol`，通过了除了 `Set/Map` 外的 137 个测试用例

默认兼容配置： 如果当前环境支持 `Proxy` 则使用 `Proxy`进行劫持，否则使用降级方案

可通过函数来选择使用哪种方案

- `disableProxy()` 禁用`Proxy`，只使用降级方案
- `enableProxy()` 只使用`Proxy`，即使当前环境不支持`Proxy`
- `resetProxy()` 恢复兼容模式

（根据木桶效应，一旦要支持低版本的环境，就要写兼容语法，那么使不使用 `Proxy` 已经不重要了， 可能在后续版本中删除 `Proxy`只支持降级语法）

## 使用

```bash
npm i @roundjs/reactivity
# or
yarn add @roundjs/reactivity
```

```javascript
import { reactive, effect } from '@roundjs/reactivity'

const data = reactive({
  name: '13',
})

effect(() => {
  console.log('更新', data.name)
})

data.name = '14'
```

因为兼容方案类似 vue2 的，所以无法对之前不存在的属性进行劫持，所以分为以下两种情况

### 已存在属性

#### 对象：

```javascript
const name = ref('11111')

const obj = reactive({
  deep: {
    name: name,
  },
})

effect(() => {
  console.log('name：', obj.deep && obj.deep.name)
})

name.value = '22222'

obj.deep.name = '33333'

// effect 被触发三次
// 初始化触发 name: 11111
// 修改 name ref触发：22222
// 修改obj触发：33333
```

#### array

```javascript
const name = ref('11111')

const obj = reactive([{ name: name }])

effect(() => {
  console.log(obj[0].name)
})

obj[0].name = '2222'

obj[0] = {
  name: '3333',
}
// log
// 11111
// 22222
// 33333
```

不同于 `vue2` 的一点，可以直接修改数组的已有下标

修改数组`length`可以使用 `set` 函数`set(array, 'length', 5)`

#### 修改原属性

```javascript
const name = ref('11111')
const arr = [{ name: name, age: 12 }]
const obj = reactive(arr)

effect(() => {
  console.log(obj[0].name, obj[0].age)
})

arr[0].age = 30 // 修改代理原对象 不会触发访问/跟踪

const arr1 = toRaw(obj)

console.log(arr1 === arr) // true

obj[0].name = '22222'

// log
// 11111 12
// 22222 30
```

修改劫持前的对象并不会触发响应，但是原属性的变化会被映射到代理上

### 未存在属性

提供了`get`、`set`、`del`、`has`、`ownKeys`函数来兼容不支持 `Proxy` 和对不存在属性的支持

#### 对不存在的属性进行监听/设置/删除使用 get / set / del

```javascript
const obj = reactive({})

effect(() => {
  console.log(get(obj, 'name'))
})

set(obj, 'name', '22222')
del(obj, 'name')

// log
// undefined
// 22222
// undefined
```

#### ownKeys 遍历不存在的值

```javascript
const obj = reactive({})

effect(() => {
  for (const key in ownKeys(obj)) {
    console.log(key)
  }
})

set(obj, 'name', '22222')
// log
// name
```

#### has 判断不存在的值

```javascript
const obj = reactive({})

effect(() => {
  console.log(has(obj, 'name'))
})

set(obj, 'name', '22222')

// log
// false
// true
```

## Credits

The implementation of this module is inspired by the following prior art in the JavaScript ecosystem:

- [Meteor Tracker](https://docs.meteor.com/api/tracker.html)
- [nx-js/observer-util](https://github.com/nx-js/observer-util)
- [salesforce/observable-membrane](https://github.com/salesforce/observable-membrane)
