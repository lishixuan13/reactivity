'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var shared = require('@vue/shared');

function warn(msg, ...args) {
    console.warn(`[Vue warn] ${msg}`, ...args);
}

let activeEffectScope;
const effectScopeStack = [];
class EffectScope {
    constructor(detached = false) {
        this.active = true;
        this.effects = [];
        this.cleanups = [];
        if (!detached && activeEffectScope) {
            this.parent = activeEffectScope;
            this.index =
                (activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(this) - 1;
        }
    }
    run(fn) {
        if (this.active) {
            try {
                this.on();
                return fn();
            }
            finally {
                this.off();
            }
        }
        else {
            warn(`cannot run an inactive effect scope.`);
        }
    }
    on() {
        if (this.active) {
            effectScopeStack.push(this);
            activeEffectScope = this;
        }
    }
    off() {
        if (this.active) {
            effectScopeStack.pop();
            activeEffectScope = effectScopeStack[effectScopeStack.length - 1];
        }
    }
    stop(fromParent) {
        if (this.active) {
            this.effects.forEach((e) => e.stop());
            this.cleanups.forEach((cleanup) => cleanup());
            if (this.scopes) {
                this.scopes.forEach((e) => e.stop(true));
            }
            // nested scope, dereference from parent to avoid memory leaks
            if (this.parent && !fromParent) {
                // optimized O(1) removal
                const last = this.parent.scopes.pop();
                if (last && last !== this) {
                    this.parent.scopes[this.index] = last;
                    last.index = this.index;
                }
            }
            this.active = false;
        }
    }
}
function effectScope(detached) {
    return new EffectScope(detached);
}
function recordEffectScope(effect, scope) {
    scope = scope || activeEffectScope;
    if (scope && scope.active) {
        scope.effects.push(effect);
    }
}
function getCurrentScope() {
    return activeEffectScope;
}
function onScopeDispose(fn) {
    if (activeEffectScope) {
        activeEffectScope.cleanups.push(fn);
    }
    else {
        warn(`onScopeDispose() is called when there is no active effect scope` +
            ` to be associated with.`);
    }
}

const createDep = (effects) => {
    const dep = new Set(effects);
    dep.w = 0;
    dep.n = 0;
    return dep;
};
const wasTracked = (dep) => (dep.w & trackOpBit) > 0;
const newTracked = (dep) => (dep.n & trackOpBit) > 0;
const initDepMarkers = ({ deps }) => {
    if (deps.length) {
        for (let i = 0; i < deps.length; i++) {
            deps[i].w |= trackOpBit; // set was tracked
        }
    }
};
const finalizeDepMarkers = (effect) => {
    const { deps } = effect;
    if (deps.length) {
        let ptr = 0;
        for (let i = 0; i < deps.length; i++) {
            const dep = deps[i];
            if (wasTracked(dep) && !newTracked(dep)) {
                dep.delete(effect);
            }
            else {
                deps[ptr++] = dep;
            }
            // clear bits
            dep.w &= ~trackOpBit;
            dep.n &= ~trackOpBit;
        }
        deps.length = ptr;
    }
};

const targetMap = new WeakMap();
// The number of effects currently being tracked recursively.
let effectTrackDepth = 0;
let trackOpBit = 1;
/**
 * The bitwise track markers support at most 30 levels of recursion.
 * This value is chosen to enable modern JS engines to use a SMI on all platforms.
 * When recursion depth is greater, fall back to using a full cleanup.
 */
const maxMarkerBits = 30;
const effectStack = [];
let activeEffect;
const ITERATE_KEY = Symbol('iterate' );
const MAP_KEY_ITERATE_KEY = Symbol('Map key iterate' );
class ReactiveEffect {
    constructor(fn, scheduler = null, scope) {
        this.fn = fn;
        this.scheduler = scheduler;
        this.active = true;
        this.deps = [];
        recordEffectScope(this, scope);
    }
    run() {
        if (!this.active) {
            return this.fn();
        }
        if (!effectStack.includes(this)) {
            try {
                effectStack.push((activeEffect = this));
                enableTracking();
                trackOpBit = 1 << ++effectTrackDepth;
                if (effectTrackDepth <= maxMarkerBits) {
                    initDepMarkers(this);
                }
                else {
                    cleanupEffect(this);
                }
                return this.fn();
            }
            finally {
                if (effectTrackDepth <= maxMarkerBits) {
                    finalizeDepMarkers(this);
                }
                trackOpBit = 1 << --effectTrackDepth;
                resetTracking();
                effectStack.pop();
                const n = effectStack.length;
                activeEffect = n > 0 ? effectStack[n - 1] : undefined;
            }
        }
    }
    stop() {
        if (this.active) {
            cleanupEffect(this);
            if (this.onStop) {
                this.onStop();
            }
            this.active = false;
        }
    }
}
function cleanupEffect(effect) {
    const { deps } = effect;
    if (deps.length) {
        for (let i = 0; i < deps.length; i++) {
            deps[i].delete(effect);
        }
        deps.length = 0;
    }
}
function effect(fn, options) {
    if (fn.effect) {
        fn = fn.effect.fn;
    }
    const _effect = new ReactiveEffect(fn);
    if (options) {
        shared.extend(_effect, options);
        if (options.scope)
            recordEffectScope(_effect, options.scope);
    }
    if (!options || !options.lazy) {
        _effect.run();
    }
    const runner = _effect.run.bind(_effect);
    runner.effect = _effect;
    return runner;
}
function stop(runner) {
    runner.effect.stop();
}
let shouldTrack = true;
const trackStack = [];
function pauseTracking() {
    trackStack.push(shouldTrack);
    shouldTrack = false;
}
function enableTracking() {
    trackStack.push(shouldTrack);
    shouldTrack = true;
}
function resetTracking() {
    const last = trackStack.pop();
    shouldTrack = last === undefined ? true : last;
}
function track(target, type, key) {
    if (!isTracking()) {
        return;
    }
    let depsMap = targetMap.get(target);
    if (!depsMap) {
        targetMap.set(target, (depsMap = new Map()));
    }
    let dep = depsMap.get(key);
    if (!dep) {
        depsMap.set(key, (dep = createDep()));
    }
    const eventInfo = { effect: activeEffect, target, type, key }
        ;
    trackEffects(dep, eventInfo);
}
function isTracking() {
    return shouldTrack && activeEffect !== undefined;
}
function trackEffects(dep, debuggerEventExtraInfo) {
    let shouldTrack = false;
    if (effectTrackDepth <= maxMarkerBits) {
        if (!newTracked(dep)) {
            dep.n |= trackOpBit; // set newly tracked
            shouldTrack = !wasTracked(dep);
        }
    }
    else {
        // Full cleanup mode.
        shouldTrack = !dep.has(activeEffect);
    }
    if (shouldTrack) {
        dep.add(activeEffect);
        activeEffect.deps.push(dep);
        if (activeEffect.onTrack) {
            activeEffect.onTrack(Object.assign({
                effect: activeEffect,
            }, debuggerEventExtraInfo));
        }
    }
}
function trigger(target, type, key, newValue, oldValue, oldTarget) {
    const depsMap = targetMap.get(target);
    if (!depsMap) {
        // never been tracked
        return;
    }
    let deps = [];
    if (type === "clear" /* CLEAR */) {
        // collection being cleared
        // trigger all effects for target
        deps = [...depsMap.values()];
    }
    else if (key === 'length' && shared.isArray(target)) {
        depsMap.forEach((dep, key) => {
            if (key === 'length' || key >= newValue) {
                deps.push(dep);
            }
        });
    }
    else {
        // schedule runs for SET | ADD | DELETE
        if (key !== void 0) {
            deps.push(depsMap.get(key));
        }
        // also run for iteration key on ADD | DELETE | Map.SET
        switch (type) {
            case "add" /* ADD */:
                if (!shared.isArray(target)) {
                    deps.push(depsMap.get(ITERATE_KEY));
                    if (shared.isMap(target)) {
                        deps.push(depsMap.get(MAP_KEY_ITERATE_KEY));
                    }
                }
                else if (shared.isIntegerKey(key)) {
                    // new index added to array -> length changes
                    deps.push(depsMap.get('length'));
                }
                break;
            case "delete" /* DELETE */:
                if (!shared.isArray(target)) {
                    deps.push(depsMap.get(ITERATE_KEY));
                    if (shared.isMap(target)) {
                        deps.push(depsMap.get(MAP_KEY_ITERATE_KEY));
                    }
                }
                break;
            case "set" /* SET */:
                if (shared.isMap(target)) {
                    deps.push(depsMap.get(ITERATE_KEY));
                }
                break;
        }
    }
    const eventInfo = { target, type, key, newValue, oldValue, oldTarget }
        ;
    if (deps.length === 1) {
        if (deps[0]) {
            {
                triggerEffects(deps[0], eventInfo);
            }
        }
    }
    else {
        const effects = [];
        for (const dep of deps) {
            if (dep) {
                effects.push(...dep);
            }
        }
        {
            triggerEffects(createDep(effects), eventInfo);
        }
    }
}
function triggerEffects(dep, debuggerEventExtraInfo) {
    // spread into array for stabilization
    for (const effect of shared.isArray(dep) ? dep : [...dep]) {
        if (effect !== activeEffect || effect.allowRecurse) {
            if (effect.onTrigger) {
                effect.onTrigger(shared.extend({ effect }, debuggerEventExtraInfo));
            }
            if (effect.scheduler) {
                effect.scheduler();
            }
            else {
                effect.run();
            }
        }
    }
}

const isNonTrackableKeys = /*#__PURE__*/ shared.makeMap(`__proto__,__v_isRef,__isVue`);
const builtInSymbols$1 = new Set(Object.getOwnPropertyNames(Symbol)
    .map((key) => Symbol[key])
    .filter(shared.isSymbol));
const get$2 = /*#__PURE__*/ createGetter();
const shallowGet = /*#__PURE__*/ createGetter(false, true);
const readonlyGet = /*#__PURE__*/ createGetter(true);
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true);
const arrayInstrumentations$1 = /*#__PURE__*/ createArrayInstrumentations$1();
function createArrayInstrumentations$1() {
    const instrumentations = {};
    ['includes', 'indexOf', 'lastIndexOf'].forEach((key) => {
        instrumentations[key] = function (...args) {
            const arr = toRaw(this);
            for (let i = 0, l = this.length; i < l; i++) {
                track(arr, "get" /* GET */, i + '');
            }
            // we run the method using the original args first (which may be reactive)
            const res = arr[key](...args);
            if (res === -1 || res === false) {
                // if that didn't work, run it again using raw values.
                return arr[key](...args.map(toRaw));
            }
            else {
                return res;
            }
        };
    });
    ['push', 'pop', 'shift', 'unshift', 'splice'].forEach((key) => {
        instrumentations[key] = function (...args) {
            pauseTracking();
            const res = toRaw(this)[key].apply(this, args);
            resetTracking();
            return res;
        };
    });
    return instrumentations;
}
function createGetter(isReadonly = false, shallow = false) {
    return function get(target, key, receiver) {
        if (key === "__v_isReactive" /* IS_REACTIVE */) {
            return !isReadonly;
        }
        else if (key === "__v_isReadonly" /* IS_READONLY */) {
            return isReadonly;
        }
        else if (key === "__v_raw" /* RAW */ &&
            receiver ===
                (isReadonly
                    ? shallow
                        ? shallowReadonlyMap
                        : readonlyMap
                    : shallow
                        ? shallowReactiveMap
                        : reactiveMap).get(target)) {
            return target;
        }
        const targetIsArray = shared.isArray(target);
        if (!isReadonly && targetIsArray && shared.hasOwn(arrayInstrumentations$1, key)) {
            return Reflect.get(arrayInstrumentations$1, key, receiver);
        }
        const res = Reflect.get(target, key, receiver);
        if (shared.isSymbol(key) ? builtInSymbols$1.has(key) : isNonTrackableKeys(key)) {
            return res;
        }
        if (!isReadonly) {
            track(target, "get" /* GET */, key);
        }
        if (shallow) {
            return res;
        }
        if (isRef(res)) {
            // ref unwrapping - does not apply for Array + integer key.
            const shouldUnwrap = !targetIsArray || !shared.isIntegerKey(key);
            return shouldUnwrap ? res.value : res;
        }
        if (shared.isObject(res)) {
            // Convert returned value into a proxy as well. we do the isObject check
            // here to avoid invalid value warning. Also need to lazy access readonly
            // and reactive here to avoid circular dependency.
            return isReadonly ? readonly(res) : reactive(res);
        }
        return res;
    };
}
const set$2 = /*#__PURE__*/ createSetter();
const shallowSet = /*#__PURE__*/ createSetter(true);
function createSetter(shallow = false) {
    return function set(target, key, value, receiver) {
        let oldValue = target[key];
        if (!shallow) {
            value = toRaw(value);
            oldValue = toRaw(oldValue);
            if (!shared.isArray(target) && isRef(oldValue) && !isRef(value)) {
                oldValue.value = value;
                return true;
            }
        }
        const hadKey = shared.isArray(target) && shared.isIntegerKey(key)
            ? Number(key) < target.length
            : shared.hasOwn(target, key);
        const result = Reflect.set(target, key, value, receiver);
        // don't trigger if target is something up in the prototype chain of original
        if (target === toRaw(receiver)) {
            if (!hadKey) {
                trigger(target, "add" /* ADD */, key, value);
            }
            else if (shared.hasChanged(value, oldValue)) {
                trigger(target, "set" /* SET */, key, value, oldValue);
            }
        }
        return result;
    };
}
function deleteProperty(target, key) {
    const hadKey = shared.hasOwn(target, key);
    const oldValue = target[key];
    const result = Reflect.deleteProperty(target, key);
    if (result && hadKey) {
        trigger(target, "delete" /* DELETE */, key, undefined, oldValue);
    }
    return result;
}
function has$2(target, key) {
    const result = Reflect.has(target, key);
    if (!shared.isSymbol(key) || !builtInSymbols$1.has(key)) {
        track(target, "has" /* HAS */, key);
    }
    return result;
}
function ownKeys$1(target) {
    track(target, "iterate" /* ITERATE */, shared.isArray(target) ? 'length' : ITERATE_KEY);
    return Reflect.ownKeys(target);
}
const mutableHandlers = {
    get: get$2,
    set: set$2,
    deleteProperty,
    has: has$2,
    ownKeys: ownKeys$1,
};
const readonlyHandlers = {
    get: readonlyGet,
    set(target, key) {
        {
            console.warn(`Set operation on key "${String(key)}" failed: target is readonly.`, target);
        }
        return true;
    },
    deleteProperty(target, key) {
        {
            console.warn(`Delete operation on key "${String(key)}" failed: target is readonly.`, target);
        }
        return true;
    },
};
const shallowReactiveHandlers = /*#__PURE__*/ shared.extend({}, mutableHandlers, {
    get: shallowGet,
    set: shallowSet,
});
// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
const shallowReadonlyHandlers = /*#__PURE__*/ shared.extend({}, readonlyHandlers, {
    get: shallowReadonlyGet,
});

const toShallow = (value) => value;
const getProto = (v) => Reflect.getPrototypeOf(v);
function get$1(target, key, isReadonly = false, isShallow = false) {
    // #1772: readonly(reactive(Map)) should return readonly + reactive version
    // of the value
    target = target["__v_raw" /* RAW */];
    const rawTarget = toRaw(target);
    const rawKey = toRaw(key);
    if (key !== rawKey) {
        !isReadonly && track(rawTarget, "get" /* GET */, key);
    }
    !isReadonly && track(rawTarget, "get" /* GET */, rawKey);
    const { has } = getProto(rawTarget);
    const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive;
    if (has.call(rawTarget, key)) {
        return wrap(target.get(key));
    }
    else if (has.call(rawTarget, rawKey)) {
        return wrap(target.get(rawKey));
    }
    else if (target !== rawTarget) {
        // #3602 readonly(reactive(Map))
        // ensure that the nested reactive `Map` can do tracking for itself
        target.get(key);
    }
}
function has$1(key, isReadonly = false) {
    const target = this["__v_raw" /* RAW */];
    const rawTarget = toRaw(target);
    const rawKey = toRaw(key);
    if (key !== rawKey) {
        !isReadonly && track(rawTarget, "has" /* HAS */, key);
    }
    !isReadonly && track(rawTarget, "has" /* HAS */, rawKey);
    return key === rawKey
        ? target.has(key)
        : target.has(key) || target.has(rawKey);
}
function size(target, isReadonly = false) {
    target = target["__v_raw" /* RAW */];
    !isReadonly && track(toRaw(target), "iterate" /* ITERATE */, ITERATE_KEY);
    return Reflect.get(target, 'size', target);
}
function add(value) {
    value = toRaw(value);
    const target = toRaw(this);
    const proto = getProto(target);
    const hadKey = proto.has.call(target, value);
    if (!hadKey) {
        target.add(value);
        trigger(target, "add" /* ADD */, value, value);
    }
    return this;
}
function set$1(key, value) {
    value = toRaw(value);
    const target = toRaw(this);
    const { has, get } = getProto(target);
    let hadKey = has.call(target, key);
    if (!hadKey) {
        key = toRaw(key);
        hadKey = has.call(target, key);
    }
    else {
        checkIdentityKeys(target, has, key);
    }
    const oldValue = get.call(target, key);
    target.set(key, value);
    if (!hadKey) {
        trigger(target, "add" /* ADD */, key, value);
    }
    else if (shared.hasChanged(value, oldValue)) {
        trigger(target, "set" /* SET */, key, value, oldValue);
    }
    return this;
}
function deleteEntry(key) {
    const target = toRaw(this);
    const { has, get } = getProto(target);
    let hadKey = has.call(target, key);
    if (!hadKey) {
        key = toRaw(key);
        hadKey = has.call(target, key);
    }
    else {
        checkIdentityKeys(target, has, key);
    }
    const oldValue = get ? get.call(target, key) : undefined;
    // forward the operation before queueing reactions
    const result = target.delete(key);
    if (hadKey) {
        trigger(target, "delete" /* DELETE */, key, undefined, oldValue);
    }
    return result;
}
function clear() {
    const target = toRaw(this);
    const hadItems = target.size !== 0;
    const oldTarget = shared.isMap(target)
            ? new Map(target)
            : new Set(target)
        ;
    // forward the operation before queueing reactions
    const result = target.clear();
    if (hadItems) {
        trigger(target, "clear" /* CLEAR */, undefined, undefined, oldTarget);
    }
    return result;
}
function createForEach(isReadonly, isShallow) {
    return function forEach(callback, thisArg) {
        const observed = this;
        const target = observed["__v_raw" /* RAW */];
        const rawTarget = toRaw(target);
        const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive;
        !isReadonly && track(rawTarget, "iterate" /* ITERATE */, ITERATE_KEY);
        return target.forEach((value, key) => {
            // important: make sure the callback is
            // 1. invoked with the reactive map as `this` and 3rd arg
            // 2. the value received should be a corresponding reactive/readonly.
            return callback.call(thisArg, wrap(value), wrap(key), observed);
        });
    };
}
function createIterableMethod(method, isReadonly, isShallow) {
    return function (...args) {
        const target = this["__v_raw" /* RAW */];
        const rawTarget = toRaw(target);
        const targetIsMap = shared.isMap(rawTarget);
        const isPair = method === 'entries' || (method === Symbol.iterator && targetIsMap);
        const isKeyOnly = method === 'keys' && targetIsMap;
        const innerIterator = target[method](...args);
        const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive;
        !isReadonly &&
            track(rawTarget, "iterate" /* ITERATE */, isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY);
        // return a wrapped iterator which returns observed versions of the
        // values emitted from the real iterator
        return {
            // iterator protocol
            next() {
                const { value, done } = innerIterator.next();
                return done
                    ? { value, done }
                    : {
                        value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
                        done,
                    };
            },
            // iterable protocol
            [Symbol.iterator]() {
                return this;
            },
        };
    };
}
function createReadonlyMethod(type) {
    return function (...args) {
        {
            const key = args[0] ? `on key "${args[0]}" ` : ``;
            console.warn(`${shared.capitalize(type)} operation ${key}failed: target is readonly.`, toRaw(this));
        }
        return type === "delete" /* DELETE */ ? false : this;
    };
}
function createInstrumentations() {
    const mutableInstrumentations = {
        get(key) {
            return get$1(this, key);
        },
        get size() {
            return size(this);
        },
        has: has$1,
        add,
        set: set$1,
        delete: deleteEntry,
        clear,
        forEach: createForEach(false, false),
    };
    const shallowInstrumentations = {
        get(key) {
            return get$1(this, key, false, true);
        },
        get size() {
            return size(this);
        },
        has: has$1,
        add,
        set: set$1,
        delete: deleteEntry,
        clear,
        forEach: createForEach(false, true),
    };
    const readonlyInstrumentations = {
        get(key) {
            return get$1(this, key, true);
        },
        get size() {
            return size(this, true);
        },
        has(key) {
            return has$1.call(this, key, true);
        },
        add: createReadonlyMethod("add" /* ADD */),
        set: createReadonlyMethod("set" /* SET */),
        delete: createReadonlyMethod("delete" /* DELETE */),
        clear: createReadonlyMethod("clear" /* CLEAR */),
        forEach: createForEach(true, false),
    };
    const shallowReadonlyInstrumentations = {
        get(key) {
            return get$1(this, key, true, true);
        },
        get size() {
            return size(this, true);
        },
        has(key) {
            return has$1.call(this, key, true);
        },
        add: createReadonlyMethod("add" /* ADD */),
        set: createReadonlyMethod("set" /* SET */),
        delete: createReadonlyMethod("delete" /* DELETE */),
        clear: createReadonlyMethod("clear" /* CLEAR */),
        forEach: createForEach(true, true),
    };
    const iteratorMethods = ['keys', 'values', 'entries', Symbol.iterator];
    iteratorMethods.forEach((method) => {
        mutableInstrumentations[method] = createIterableMethod(method, false, false);
        readonlyInstrumentations[method] = createIterableMethod(method, true, false);
        shallowInstrumentations[method] = createIterableMethod(method, false, true);
        shallowReadonlyInstrumentations[method] = createIterableMethod(method, true, true);
    });
    return [
        mutableInstrumentations,
        readonlyInstrumentations,
        shallowInstrumentations,
        shallowReadonlyInstrumentations,
    ];
}
const [mutableInstrumentations, readonlyInstrumentations, shallowInstrumentations, shallowReadonlyInstrumentations,] = /* #__PURE__*/ createInstrumentations();
function createInstrumentationGetter(isReadonly, shallow) {
    const instrumentations = shallow
        ? isReadonly
            ? shallowReadonlyInstrumentations
            : shallowInstrumentations
        : isReadonly
            ? readonlyInstrumentations
            : mutableInstrumentations;
    return (target, key, receiver) => {
        if (key === "__v_isReactive" /* IS_REACTIVE */) {
            return !isReadonly;
        }
        else if (key === "__v_isReadonly" /* IS_READONLY */) {
            return isReadonly;
        }
        else if (key === "__v_raw" /* RAW */) {
            return target;
        }
        return Reflect.get(shared.hasOwn(instrumentations, key) && key in target
            ? instrumentations
            : target, key, receiver);
    };
}
const mutableCollectionHandlers = {
    get: /*#__PURE__*/ createInstrumentationGetter(false, false),
};
const shallowCollectionHandlers = {
    get: /*#__PURE__*/ createInstrumentationGetter(false, true),
};
const readonlyCollectionHandlers = {
    get: /*#__PURE__*/ createInstrumentationGetter(true, false),
};
const shallowReadonlyCollectionHandlers = {
    get: /*#__PURE__*/ createInstrumentationGetter(true, true),
};
function checkIdentityKeys(target, has, key) {
    const rawKey = toRaw(key);
    if (rawKey !== key && has.call(target, rawKey)) {
        const type = shared.toRawType(target);
        console.warn(`Reactive ${type} contains both the raw and reactive ` +
            `versions of the same object${type === `Map` ? ` as keys` : ``}, ` +
            `which can lead to inconsistencies. ` +
            `Avoid differentiating between the raw and reactive versions ` +
            `of an object and only use the reactive version if possible.`);
    }
}

/**
 * Define a property.
 */
function def(obj, key, val, enumerable) {
    Object.defineProperty(obj, key, {
        value: val,
        enumerable: !!enumerable,
        writable: true,
        configurable: true,
    });
}
function defGet(obj, key, get, enumerable) {
    Object.defineProperty(obj, key, {
        get: get,
        enumerable: !!enumerable,
        configurable: true,
    });
}
const arrayInstrumentations = /*#__PURE__*/ createArrayInstrumentations();
const readonlyArrayInstrumentations = createReadonlyArrayInstrumentations();
function createReadonlyArrayInstrumentations() {
    const instrumentations = {};
    ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].forEach((key) => {
        instrumentations[key] = function () {
            const origin = toRaw(this);
            {
                console.warn(`Set operation on methods "${String(key)}" failed: target is readonly.`, origin);
            }
        };
    });
    return instrumentations;
}
function createArrayInstrumentations() {
    const instrumentations = {};
    ['includes', 'indexOf', 'lastIndexOf'].forEach((key) => {
        instrumentations[key] = function (...args) {
            const arr = toRaw(this);
            for (let i = 0, l = this.length; i < l; i++) {
                track(arr, "get" /* GET */, i + '');
            }
            // we run the method using the original args first (which may be reactive)
            const res = arr[key](...args);
            if (res === -1 || res === false) {
                // if that didn't work, run it again using raw values.
                return arr[key](...args.map(toRaw));
            }
            else {
                return res;
            }
        };
    });
    ['push', 'pop', 'shift', 'unshift', 'splice'].forEach((key) => {
        instrumentations[key] = function (...args) {
            pauseTracking();
            const origin = toRaw(this);
            const oldLen = origin.length;
            const changeArray = triggerArrayMethods(args, key, origin);
            const res = origin[key](...args);
            const newLen = origin.length;
            // 新增了元素
            if (oldLen !== newLen) {
                if (oldLen < newLen) {
                    for (let i = oldLen; i < newLen; i++) {
                        defineReactiveByProxy(this, origin, i);
                    }
                }
                else if (oldLen > newLen) {
                    for (let i = newLen; i < oldLen; i++) {
                        delete this[i];
                    }
                }
                this.length = newLen;
                trigger(origin, "set" /* SET */, 'length', newLen, oldLen);
                if (changeArray) {
                    changeArray.forEach(({ type, key, oldVal }) => {
                        trigger(origin, type, formatIntegerKey(key), type === "delete" /* DELETE */ ? undefined : origin[key], oldVal);
                    });
                }
            }
            resetTracking();
            return res;
        };
    });
    return instrumentations;
}
function triggerArrayMethods(args, methods, origin) {
    let changeArray = [];
    const len = origin.length;
    switch (methods) {
        case 'push':
            changeArray = args.map((v, i) => ({
                type: "add" /* ADD */,
                key: i + len,
                oldVal: undefined,
            }));
            break;
        case 'unshift':
            changeArray = rearrange(0, len + 1, len, origin);
            break;
        case 'pop':
            changeArray = [
                {
                    type: "delete" /* DELETE */,
                    key: len - 1,
                    oldVal: origin[len - 1],
                },
            ];
        case 'shift':
            changeArray = rearrange(0, len - 1, len - 1, origin);
            break;
        case 'splice':
            if (args && (args[1] > 0 || args.length > 2)) {
                let start = args[0];
                if (start >= len) {
                    start = len;
                }
                else if (start < 0) {
                    if (Math.abs(start) > len) {
                        start = 0;
                    }
                    else {
                        start = len - start;
                    }
                }
                // 新的长度等于减去删除的加上新增的
                const end = len - args[1] + args.length;
                changeArray = rearrange(start, end, len, origin);
            }
            break;
    }
    return changeArray;
}
// 触发数组重新排列 shift unshift splice
function rearrange(start, end, len, array) {
    const arr = [];
    if (end > start) {
        for (let i = start; i < end; i++) {
            const isAdd = i >= len;
            arr.push({
                type: isAdd ? "add" /* ADD */ : "set" /* SET */,
                key: i,
                oldVal: isAdd ? undefined : array[i],
            });
        }
    }
    return arr;
}
/**
 * Augment a target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
function copyAugment(target, src) {
    const keys = Object.keys(src);
    for (let i = 0, l = keys.length; i < l; i++) {
        const key = keys[i];
        def(target, key, src[key]);
    }
}
function defProxy(value, isReadonly, shallow) {
    let proxy = Object.create(value);
    if (shared.isArray(value)) {
        proxy = [];
        copyAugment(proxy, isReadonly ? readonlyArrayInstrumentations : arrayInstrumentations);
        defineReactive(proxy, value, 'length', isReadonly, shallow);
    }
    walk(proxy, value, isReadonly, shallow);
    if (isRef(value)) {
        defineReactive(proxy, value, 'value', isReadonly, shallow);
    }
    def(proxy, "__v_isReactive" /* IS_REACTIVE */, !isReadonly);
    def(proxy, "__v_isReadonly" /* IS_READONLY */, isReadonly);
    def(proxy, "__v_isDefine" /* IS_DEFINE */, true);
    def(proxy, "__v_isShallow" /* IS_SHALLOW */, shallow);
    defGet(proxy, "__v_raw" /* RAW */, function () {
        if ((isReadonly
            ? shallow
                ? shallowReadonlyMap
                : readonlyMap
            : shallow
                ? shallowReactiveMap
                : reactiveMap).get(value)) {
            return value;
        }
    });
    return proxy;
}
function walk(proxy, target, isReadonly, shallow) {
    const keys = Object.keys(target);
    for (let i = 0; i < keys.length; i++) {
        defineReactive(proxy, target, keys[i], isReadonly, shallow);
    }
}
/**
 * Define a reactive property on an Object.
 */
function defineReactive(proxy, target, key, isReadonly = false, shallow = false) {
    const property = Object.getOwnPropertyDescriptor(target, key);
    if (property && property.configurable === false) {
        return;
    }
    // cater for pre-defined getter/setters
    const getter = property && property.get;
    const setter = property && property.set;
    Object.defineProperty(proxy, key, {
        enumerable: true,
        configurable: true,
        get: function reactiveGetter() {
            const res = getter ? getter.call(proxy) : target[key];
            if (!isReadonly) {
                track(target, "get" /* GET */, key);
            }
            if (shallow) {
                return res;
            }
            const targetIsArray = shared.isArray(target);
            if (isRef(res)) {
                // ref unwrapping - does not apply for Array + integer key.
                const shouldUnwrap = !targetIsArray || !shared.isIntegerKey(key);
                return shouldUnwrap ? res.value : res;
            }
            if (shared.isObject(res)) {
                return isReadonly ? readonly(res) : reactive(res);
            }
            return res;
        },
        set: function reactiveSetter(value) {
            if (isReadonly) {
                readonlySetWarn(key, target);
                return;
            }
            let oldValue = getter ? getter.call(proxy) : target[key];
            if (!shallow) {
                value = toRaw(value);
                oldValue = toRaw(oldValue);
                if (!shared.isArray(target) && isRef(oldValue) && !isRef(value)) {
                    oldValue.value = value;
                    return true;
                }
            }
            if (oldValue === value || (oldValue !== oldValue && value !== value)) {
                return;
            }
            if (getter && !setter) {
                return;
            }
            if (setter) {
                setter.call(proxy, value);
            }
            else {
                target[key] = value;
            }
            trigger(target, "set" /* SET */, key, value, oldValue);
        },
    });
}
function isShallow(proxy) {
    return !!(proxy && proxy["__v_isShallow" /* IS_SHALLOW */]);
}
function defineReactiveByProxy(proxy, target, key) {
    defineReactive(proxy, target, key, isReadonly(proxy), isShallow(proxy));
}
function findProxyMap(target) {
    if (reactiveMap.has(target)) {
        return reactiveMap.get(target);
    }
    else if (shallowReactiveMap.has(target)) {
        return shallowReactiveMap.get(target);
    }
    else if (readonlyMap.has(target)) {
        return readonlyMap.get(target);
    }
    else if (shallowReadonlyMap.has(target)) {
        return shallowReadonlyMap.get(target);
    }
}
function readonlySetWarn(key, target) {
    {
        console.warn(`Set operation on key "${String(key)}" failed: target is readonly.`, target);
    }
}
const builtInSymbols = new Set(Object.getOwnPropertyNames(Symbol)
    .map((key) => Symbol[key])
    .filter(shared.isSymbol));
function has(target, key) {
    if (!shared.isObject(target)) {
        {
            console.warn(`target cannot be made reactive: ${String(target)}`);
        }
        return;
    }
    const res = key in target;
    pauseTracking();
    const shouldTrack = isReactiveDefine(target) &&
        !isReadonly(target) &&
        (!shared.isSymbol(key) || !builtInSymbols.has(key));
    resetTracking();
    if (shouldTrack) {
        track(toRaw(target), "has" /* HAS */, formatIntegerKey(key));
    }
    return res;
}
function formatIntegerKey(key) {
    return shared.isIntegerKey(key + '') ? key + '' : key;
}
function isReactiveDefine(target) {
    return !!(target && target["__v_isDefine" /* IS_DEFINE */]);
}
function ownKeys(target) {
    pauseTracking();
    const shouldTrack = isReactiveDefine(target) && !isReadonly(target);
    resetTracking();
    if (shouldTrack) {
        const origin = toRaw(target);
        track(origin, "iterate" /* ITERATE */, shared.isArray(origin) ? 'length' : ITERATE_KEY);
    }
    return target;
}
function get(target, key) {
    if (!isReactiveDefine(target)) {
        return target[key];
    }
    const origin = toRaw(target);
    const res = origin[key];
    const _isReadonly = isReadonly(target);
    if (!_isReadonly) {
        track(origin, "get" /* GET */, formatIntegerKey(key));
    }
    if (isShallow(target)) {
        return res;
    }
    const targetIsArray = shared.isArray(origin);
    if (isRef(res)) {
        // ref unwrapping - does not apply for Array + integer key.
        const shouldUnwrap = !targetIsArray || !shared.isIntegerKey(key);
        return shouldUnwrap ? res.value : res;
    }
    if (shared.isObject(res)) {
        return _isReadonly ? readonly(res) : reactive(res);
    }
    return res;
}
function set(target, key, val) {
    if (!shared.isObject(target)) {
        {
            console.warn(`target cannot be made reactive: ${String(target)}`);
        }
        return;
    }
    const isDefine = isReactiveDefine(target);
    if (isReactive(target) && !isDefine) {
        target[key] = val;
        return val;
    }
    if (key in Object.prototype)
        return val;
    const isArrayLength = isDefine && shared.isArray(target) && key === 'length';
    if (!isArrayLength) {
        // 如果是 length 改变走下面路线
        if (key in target) {
            target[key] = val;
            return val;
        }
    }
    if (isReadonly(target)) {
        readonlySetWarn(key, target);
        return;
    }
    if (!isReactive(target)) {
        const proxy = findProxyMap(target);
        // 原属性的新增，不需要通知
        target[key] = val;
        if (proxy) {
            defineReactiveByProxy(proxy, target, key);
        }
        return;
    }
    const proxy = target;
    const origin = toRaw(target);
    if (!isShallow(proxy)) {
        val = toRaw(val);
    }
    origin[key] = val;
    defineReactiveByProxy(proxy, origin, key);
    if (isArrayLength) {
        trigger(origin, "set" /* SET */, key, val, proxy.length);
        proxy.length = origin.length;
    }
    else {
        trigger(origin, "add" /* ADD */, formatIntegerKey(key), val);
    }
    if (shared.isArray(origin) && shared.isIntegerKey(key + '')) {
        trigger(origin, "set" /* SET */, 'length', origin.length, proxy.length);
        proxy.length = origin.length;
    }
}
function del(target, key) {
    if (!shared.isObject(target)) {
        {
            console.warn(`target cannot be made reactive: ${String(target)}`);
        }
        return;
    }
    if (isReactive(target) && !isReactiveDefine(target)) {
        delete target[key];
        return;
    }
    if (shared.isArray(target) && shared.isIntegerKey(key)) {
        target.splice(key, 1);
        return;
    }
    if (!shared.hasOwn(target, key)) {
        return;
    }
    if (isReadonly(target) && true) {
        console.warn(`Delete operation on key "${String(key)}" failed: target is readonly.`, target);
        return;
    }
    if (!isReactive(target)) {
        const proxy = findProxyMap(target);
        // 原属性的删除，不需要通知
        delete target[key];
        if (proxy) {
            delete proxy[key];
        }
        return;
    }
    const origin = toRaw(target);
    const oldValue = origin[key];
    delete target[key];
    delete origin[key];
    trigger(origin, "delete" /* DELETE */, formatIntegerKey(key), undefined, oldValue);
}
function defProxyRef(target) {
    if (!shared.isPlainObject) {
        {
            console.warn(`target cannot be made reactive: ${String(target)}`);
        }
        return target;
    }
    const proxy = Object.create(target);
    for (const key in target) {
        Object.defineProperty(proxy, key, {
            enumerable: true,
            configurable: true,
            get: function () {
                unref(target[key]);
            },
            set: (value) => {
                const oldValue = target[key];
                if (isRef(oldValue) && !isRef(value)) {
                    oldValue.value = value;
                }
                else {
                    target[key] = value;
                }
            },
        });
    }
    return proxy;
}

function isNative(Ctor) {
    return typeof Ctor === 'function' && /native code/.test(Ctor.toString());
}
const supportProxy = isNative(Proxy);
let shouldUseProxy = supportProxy;
function disableProxy() {
    shouldUseProxy = false;
}
function enableProxy() {
    shouldUseProxy = true;
}
function resetProxy() {
    shouldUseProxy = supportProxy;
}

const reactiveMap = new WeakMap();
const shallowReactiveMap = new WeakMap();
const readonlyMap = new WeakMap();
const shallowReadonlyMap = new WeakMap();
function targetTypeMap(rawType) {
    switch (rawType) {
        case 'Object':
        case 'Array':
            return 1 /* COMMON */;
        case 'Map':
        case 'Set':
        case 'WeakMap':
        case 'WeakSet':
            return 2 /* COLLECTION */;
        default:
            return 0 /* INVALID */;
    }
}
function getTargetType(value) {
    return value["__v_skip" /* SKIP */] || !Object.isExtensible(value)
        ? 0 /* INVALID */
        : targetTypeMap(shared.toRawType(value));
}
/**
 * Creates a reactive copy of the original object.
 *
 * The reactive conversion is "deep"—it affects all nested properties. In the
 * ES2015 Proxy based implementation, the returned proxy is **not** equal to the
 * original object. It is recommended to work exclusively with the reactive
 * proxy and avoid relying on the original object.
 *
 * A reactive object also automatically unwraps refs contained in it, so you
 * don't need to use `.value` when accessing and mutating their value:
 *
 * ```js
 * const count = ref(0)
 * const obj = reactive({
 *   count
 * })
 *
 * obj.count++
 * obj.count // -> 1
 * count.value // -> 1
 * ```
 */
// export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
function reactive(target) {
    // if trying to observe a readonly proxy, return the readonly version.
    if (target && target["__v_isReadonly" /* IS_READONLY */]) {
        return target;
    }
    return createReactiveObject(target, false, false, mutableHandlers, mutableCollectionHandlers, reactiveMap);
}
/**
 * Return a shallowly-reactive copy of the original object, where only the root
 * level properties are reactive. It also does not auto-unwrap refs (even at the
 * root level).
 */
function shallowReactive(target) {
    return createReactiveObject(target, false, true, shallowReactiveHandlers, shallowCollectionHandlers, shallowReactiveMap);
}
/**
 * Creates a readonly copy of the original object. Note the returned copy is not
 * made reactive, but `readonly` can be called on an already reactive object.
 */
function readonly(target) {
    return createReactiveObject(target, true, false, readonlyHandlers, readonlyCollectionHandlers, readonlyMap);
}
/**
 * Returns a reactive-copy of the original object, where only the root level
 * properties are readonly, and does NOT unwrap refs nor recursively convert
 * returned properties.
 * This is used for creating the props proxy object for stateful components.
 */
function shallowReadonly(target) {
    return createReactiveObject(target, true, true, shallowReadonlyHandlers, shallowReadonlyCollectionHandlers, shallowReadonlyMap);
}
function createReactiveObject(target, isReadonly, shallow, baseHandlers, collectionHandlers, proxyMap) {
    if (!shared.isObject(target)) {
        {
            console.warn(`value cannot be made reactive: ${String(target)}`);
        }
        return target;
    }
    // target is already a Proxy, return it.
    // exception: calling readonly() on a reactive object
    if (target["__v_raw" /* RAW */] &&
        !(isReadonly && target["__v_isReactive" /* IS_REACTIVE */])) {
        return target;
    }
    // target already has corresponding Proxy
    const existingProxy = proxyMap.get(target);
    if (existingProxy) {
        return existingProxy;
    }
    // only a whitelist of value types can be observed.
    const targetType = getTargetType(target);
    if (targetType === 0 /* INVALID */) {
        return target;
    }
    const proxy = shouldUseProxy
        ? new Proxy(target, targetType === 2 /* COLLECTION */ ? collectionHandlers : baseHandlers)
        : defProxy(target, isReadonly, shallow);
    proxyMap.set(target, proxy);
    return proxy;
}
function isReactive(value) {
    if (isReadonly(value)) {
        return isReactive(value["__v_raw" /* RAW */]);
    }
    return !!(value && value["__v_isReactive" /* IS_REACTIVE */]);
}
function isReadonly(value) {
    return !!(value && value["__v_isReadonly" /* IS_READONLY */]);
}
function isProxy(value) {
    return isReactive(value) || isReadonly(value);
}
function toRaw(observed) {
    const raw = observed && observed["__v_raw" /* RAW */];
    return raw ? toRaw(raw) : observed;
}
function markRaw(value) {
    shared.def(value, "__v_skip" /* SKIP */, true);
    return value;
}
const toReactive = (value) => shared.isObject(value) ? reactive(value) : value;
const toReadonly = (value) => shared.isObject(value) ? readonly(value) : value;

function trackRefValue(ref) {
    if (isTracking()) {
        ref = toRaw(ref);
        if (!ref.dep) {
            ref.dep = createDep();
        }
        {
            trackEffects(ref.dep, {
                target: ref,
                type: "get" /* GET */,
                key: 'value',
            });
        }
    }
}
function triggerRefValue(ref, newVal) {
    ref = toRaw(ref);
    if (ref.dep) {
        {
            triggerEffects(ref.dep, {
                target: ref,
                type: "set" /* SET */,
                key: 'value',
                newValue: newVal,
            });
        }
    }
}
function isRef(r) {
    return Boolean(r && r.__v_isRef === true);
}
function ref(value) {
    return createRef(value, false);
}
function shallowRef(value) {
    return createRef(value, true);
}
class RefImpl {
    constructor(value, _shallow) {
        this._shallow = _shallow;
        this.dep = undefined;
        this.__v_isRef = true;
        this._rawValue = _shallow ? value : toRaw(value);
        this._value = _shallow ? value : toReactive(value);
    }
    get value() {
        trackRefValue(this);
        return this._value;
    }
    set value(newVal) {
        newVal = this._shallow ? newVal : toRaw(newVal);
        if (shared.hasChanged(newVal, this._rawValue)) {
            this._rawValue = newVal;
            this._value = this._shallow ? newVal : toReactive(newVal);
            triggerRefValue(this, newVal);
        }
    }
}
function createRef(rawValue, shallow) {
    if (isRef(rawValue)) {
        return rawValue;
    }
    return new RefImpl(rawValue, shallow);
}
function triggerRef(ref) {
    triggerRefValue(ref, ref.value );
}
function unref(ref) {
    return isRef(ref) ? ref.value : ref;
}
const shallowUnwrapHandlers = {
    get: (target, key, receiver) => unref(Reflect.get(target, key, receiver)),
    set: (target, key, value, receiver) => {
        const oldValue = target[key];
        if (isRef(oldValue) && !isRef(value)) {
            oldValue.value = value;
            return true;
        }
        else {
            return Reflect.set(target, key, value, receiver);
        }
    },
};
function proxyRefs(objectWithRefs) {
    return isReactive(objectWithRefs)
        ? objectWithRefs
        : shouldUseProxy
            ? new Proxy(objectWithRefs, shallowUnwrapHandlers)
            : defProxyRef;
}
class CustomRefImpl {
    constructor(factory) {
        this.dep = undefined;
        this.__v_isRef = true;
        const { get, set } = factory(() => trackRefValue(this), () => triggerRefValue(this));
        this._get = get;
        this._set = set;
    }
    get value() {
        return this._get();
    }
    set value(newVal) {
        this._set(newVal);
    }
}
function customRef(factory) {
    return new CustomRefImpl(factory);
}
function toRefs(object) {
    if (!isProxy(object)) {
        console.warn(`toRefs() expects a reactive object but received a plain one.`);
    }
    const ret = shared.isArray(object) ? new Array(object.length) : {};
    for (const key in object) {
        ret[key] = toRef(object, key);
    }
    return ret;
}
class ObjectRefImpl {
    constructor(_object, _key) {
        this._object = _object;
        this._key = _key;
        this.__v_isRef = true;
    }
    get value() {
        return this._object[this._key];
    }
    set value(newVal) {
        this._object[this._key] = newVal;
    }
}
function toRef(object, key) {
    const val = object[key];
    return isRef(val) ? val : new ObjectRefImpl(object, key);
}

class ComputedRefImpl {
    constructor(getter, _setter, isReadonly) {
        this._setter = _setter;
        this.dep = undefined;
        this._dirty = true;
        this.__v_isRef = true;
        this.effect = new ReactiveEffect(getter, () => {
            if (!this._dirty) {
                this._dirty = true;
                triggerRefValue(this);
            }
        });
        this["__v_isReadonly" /* IS_READONLY */] = isReadonly;
    }
    get value() {
        // the computed ref may get wrapped by other proxies e.g. readonly() #3376
        const self = toRaw(this);
        trackRefValue(self);
        if (self._dirty) {
            self._dirty = false;
            self._value = self.effect.run();
        }
        return self._value;
    }
    set value(newValue) {
        this._setter(newValue);
    }
}
function computed(getterOrOptions, debugOptions) {
    let getter;
    let setter;
    const onlyGetter = shared.isFunction(getterOrOptions);
    if (onlyGetter) {
        getter = getterOrOptions;
        setter = () => {
                console.warn('Write operation failed: computed value is readonly');
            }
            ;
    }
    else {
        getter = getterOrOptions.get;
        setter = getterOrOptions.set;
    }
    const cRef = new ComputedRefImpl(getter, setter, onlyGetter || !setter);
    if (debugOptions) {
        cRef.effect.onTrack = debugOptions.onTrack;
        cRef.effect.onTrigger = debugOptions.onTrigger;
    }
    return cRef;
}

var _a;
const tick = Promise.resolve();
const queue = [];
let queued = false;
const flush = () => {
    for (let i = 0; i < queue.length; i++) {
        queue[i]();
    }
    queue.length = 0;
    queued = false;
};
const scheduler = (fn) => {
    queue.push(fn);
    if (!queued) {
        queued = true;
        tick.then(flush);
    }
};
class DeferredComputedRefImpl {
    constructor(getter) {
        this.dep = undefined;
        this._dirty = true;
        this.__v_isRef = true;
        this[_a] = true;
        let compareTarget;
        let hasCompareTarget = false;
        let scheduled = false;
        this.effect = new ReactiveEffect(getter, (computedTrigger) => {
            if (this.dep) {
                if (computedTrigger) {
                    compareTarget = this._value;
                    hasCompareTarget = true;
                }
                else if (!scheduled) {
                    const valueToCompare = hasCompareTarget ? compareTarget : this._value;
                    scheduled = true;
                    hasCompareTarget = false;
                    scheduler(() => {
                        if (this.effect.active && this._get() !== valueToCompare) {
                            triggerRefValue(this);
                        }
                        scheduled = false;
                    });
                }
                // chained upstream computeds are notified synchronously to ensure
                // value invalidation in case of sync access; normal effects are
                // deferred to be triggered in scheduler.
                for (const e of this.dep) {
                    if (e.computed) {
                        e.scheduler(true /* computedTrigger */);
                    }
                }
            }
            this._dirty = true;
        });
        this.effect.computed = true;
    }
    _get() {
        if (this._dirty) {
            this._dirty = false;
            return (this._value = this.effect.run());
        }
        return this._value;
    }
    get value() {
        trackRefValue(this);
        // the computed ref may get wrapped by other proxies e.g. readonly() #3376
        return toRaw(this)._get();
    }
}
_a = "__v_isReadonly" /* IS_READONLY */;
function deferredComputed(getter) {
    return new DeferredComputedRefImpl(getter);
}

exports.EffectScope = EffectScope;
exports.ITERATE_KEY = ITERATE_KEY;
exports.ReactiveEffect = ReactiveEffect;
exports.computed = computed;
exports.customRef = customRef;
exports.defProxyRef = defProxyRef;
exports.deferredComputed = deferredComputed;
exports.del = del;
exports.disableProxy = disableProxy;
exports.effect = effect;
exports.effectScope = effectScope;
exports.enableProxy = enableProxy;
exports.enableTracking = enableTracking;
exports.get = get;
exports.getCurrentScope = getCurrentScope;
exports.has = has;
exports.isProxy = isProxy;
exports.isReactive = isReactive;
exports.isReadonly = isReadonly;
exports.isRef = isRef;
exports.markRaw = markRaw;
exports.onScopeDispose = onScopeDispose;
exports.ownKeys = ownKeys;
exports.pauseTracking = pauseTracking;
exports.proxyRefs = proxyRefs;
exports.reactive = reactive;
exports.readonly = readonly;
exports.ref = ref;
exports.resetProxy = resetProxy;
exports.resetTracking = resetTracking;
exports.set = set;
exports.shallowReactive = shallowReactive;
exports.shallowReadonly = shallowReadonly;
exports.shallowRef = shallowRef;
exports.stop = stop;
exports.toRaw = toRaw;
exports.toRef = toRef;
exports.toRefs = toRefs;
exports.track = track;
exports.trigger = trigger;
exports.triggerRef = triggerRef;
exports.unref = unref;
