export const Utilities = new class Utilities {
    sleep(ms) {return new Promise(res => setTimeout(res, ms));}
    makLazy(factory) {
        let cache;
    
        return () => (cache ??= factory(), cache);
    }
}

const monkeyPatches = new WeakMap;
const proxySymbol = Symbol("monkeyPatched");
export const monkeyPatch = (target, name, fn, {force = true} = {}) => {
    if (typeof name === "object") {
        const patches = new Set();

        for (const method of Object.keys(name)) {
            const patchFn = name[method];

            patches.add(
                monkeyPatch(target, method, patchFn)
            );
        }

        return patches;
    }

    if (target[name] == null && force) target[name] = function () {};
    if (typeof target[name] !== "function") throw new Error("Method to patch is not a function.");

    const original = target[name][proxySymbol] ?? target[name];
    const firstPatch = !monkeyPatches.has(original);

    if (firstPatch) {
        const proxy = function () {
            let originalReturn, defaultPrevented = false;
            let returnValue, returnValueSet = false;

            const data = {
                get returnValueSet() {return returnValueSet;},
                get defaultPrevented() {return defaultPrevented;},
                get returnValue() {return returnValue;},
                methodArguments: arguments,
                preventDefault() {defaultPrevented = true;},
                return(value) {returnValue = value; returnValueSet = true;},
                callOriginal: (args = arguments) => new.target ? new original(...args) : Reflect.apply(original, this, args)
            };

            for (const monkeyPatch of monkeyPatches.get(original).patches) {
                Reflect.apply(monkeyPatch, this, [data]);
            }

            if (!defaultPrevented) {
                originalReturn = data.callOriginal();
            }

            return returnValueSet ? returnValue : originalReturn;
        };

        proxy[proxySymbol] = original;

        Object.defineProperties(proxy, Object.getOwnPropertyDescriptors(original));

        monkeyPatches.set(original, {
            patches: new Set(),
            proxyFn: proxy
        });
    }

    const patch = monkeyPatches.get(original);
    patch.patches.add(fn);
    Object.defineProperty(target, name, {
        ...Object.getOwnPropertyDescriptor(target, name),
        value: patch.proxyFn
    });

    return () => {
        patch.patches.delete(fn);
    };
}

export const WebpackModules = (() => {
    const allowedTypes = new Set(["object", "function"]);
    const Filters = {
        byProps(...props) {
            return m => props.every(prop => prop in m);
        },
        byDisplayName(name) {
            return m => m?.displayName === name;
        }
    };

    return new class WebpackModules {
        get Filters() {return Filters;}
        get chunkName() {return "webpackChunkdiscord_app";}

        constructor() {
            this.globalPromise = new Promise(resolve => {
                if (this.chunkName in window) return resolve();

                Object.defineProperty(window, this.chunkName, {
                    configurable: true,
                    set: (value) => {
                        Object.defineProperty(window, this.chunkName, {
                            value,
                            configurable: true,
                            enumerable: true,
                            writable: true
                        });

                        resolve();
                    }
                });
            });
            
            this.readyPromise = this.globalPromise.then(() => new Promise(async done => {
                let Dispatcher;
                for (; Dispatcher == null; Dispatcher = this.getByProps("dirtyDispatch")) {
                    await Utilities.sleep(5);
                }
                
                Dispatcher.subscribe("CONNECTION_OPEN", done);
                Dispatcher.subscribe("TRACK", done);
            }));
        }

        get require() {
            if (this._require) return this._require;
            if (!Array.isArray(window[this.chunkName])) return null;

            const chunk = [[Symbol("kernel-lib")], {}, _ => _];
            this._require = window[this.chunkName].push(chunk);
            window[this.chunkName].splice(window[this.chunkName].indexOf(chunk), 1);

            return this.require;
        }
    
        getModule(filter, {all = false, default: defaultExports = true} = {}) {
            const cache = this.require.c;
            if (!cache) return;

            const found = [];
            const modules = Object.values(this.require.c);
            const wrapped = (module, id) => {
                try {return Boolean(filter(module, id));}
                catch {return false;}
            };

            for (let i = 0; i < modules.length; i++) {
                const {exports, id} = modules[i];

                if (!exports || !allowedTypes.has(typeof exports) || exports === window) continue;

                if (wrapped(exports, id)) {
                    if (!all) return exports;

                    found.push(exports);
                }
                else if ("__esModule" in exports && allowedTypes.has(typeof exports.default) && wrapped(exports.default, id)) {
                    if (!all) return defaultExports ? exports.default : exports;

                    found.push(defaultExports ? exports.default : exports);
                } 
            }

            return all ? found : null;
        }
    
        getAllByProps(...props) {return this.getModule(Filters.byProps(...props), {all: true});}     
        getByDisplayName(name) {return this.getModule(Filters.byDisplayName(name));}
        getDefault(filter) {return this.getModule((m, i) => filter(m.default, i));}
        getByRegex(regex) {return this.getModule(m => regex.test(m.toString()));}
        getByProps(...props) {return this.getModule(Filters.byProps(...props));}
        getModules(filter) {return this.getModule(filter, {all: true});}
        getByIndex(index) {return this.require?.c[index]?.exports;}
        then(fn) {return this.readyPromise.then(fn);}
        getParent(filter) {
            let parent = null;
            
            this.getModule((m, i) => filter(m, i) ? (parent = this.require.m[i], true) : false);

            return parent;
        }
        getIndex(filter) {
            let index = 0;
            
            this.getModule((m, i) => filter(m, i) ? (index = i, true) : false);

            return index;
        }
    }
})();

export class TreeSearcher {
    constructor(target, type) {
        this._current = target;
        this._break = false;

        switch (type) {
            case "react": {
                this.defaultWalkable = ["props", "children"];
            } break;

            case "react-vdom": {
                this.defaultWalkable = ["child", "return", "alternate"];
            } break;

            default: {
                this.defaultWalkable = [];
            };
        }
    }

    type() {return typeof this._current;}

    isNull() {return this._current == null;}

    isArray() {return this._break = !Array.isArray(this._current), this;}

    isNumber() {return this._break = this.type() !== "number", this;}

    isFunction() {return this._break = this.type() !== "function", this;}

    isObject() {return this._break = !(this.type() === "object" && this._current !== null), this;}

    where(condition) {return this._break = !condition.call(this, this.value(), this), this;}

    walk(...path) {
        if (this._break) return this;

        for (let i = 0; i < path.length; i++) {
            if (!this._current) break;

            this._current = this._current?.[path[i]];
        }

        if (!this._current) this._break = true;

        return this;
    }

    find(filter, {ignore = [], walkable = this.defaultWalkable, maxProperties = 100} = {}) {
        if (this._break) return this;
        const stack = [this._current];
        
        while (stack.length && maxProperties) {
            const node = stack.shift();
            if (filter(node)) {
                this._current = node;
                return this;
            }

            if (Array.isArray(node)) stack.push(...node);
            else if (typeof node === "object" && node !== null) {
                for (const key in node) {
                    const value = node[key];

                    if (
                        (walkable.length && (~walkable.indexOf(key) && !~ignore.indexOf(key))) ||
                        node && ~ignore.indexOf(key)
                    ) {
                        stack.push(value);
                    }
                }
            }
            maxProperties--;
        }

        this._break = true;
        this._current = null;

        return this;
    }

    put(factory) {
        if (this._break) return this;

        const value = this._current = factory.call(this, this.value(), this);
        if (value == null) this._break = true;

        return this;
    }

    call(_this, ...args) {
        if (this._break) return this;

        const value = this._current = this._current.call(_this, ...args);
        if (value == null) this._break = true;
        
        return this;
    }

    break() {return this._break = true, this;}

    value() {return this._current;}

    toString() {return String(this._current);}

    then(onSuccess, onError) {
        return Promise.resolve(this._current)
            .then(
                value => (onSuccess.call(this, value), this),
                onError
                    ? (error) => (onError(error), this)
                    : void 0
            );
    }
}
