// A deliberately tiny DOM stub: just enough surface for badge/room.js to
// mount and render under node --test (no jsdom — the package has zero
// dependencies). Supports the subset the room actually uses: element trees,
// class lists, data- attributes, single compound selectors (tag, .class,
// #id, [attr="value"]), bubbling CustomEvents, and no-op scrolling.

const allElements = new Set();

function parseSelector(selector) {
  // One compound selector, no combinators: tag, #id, .class, [attr="value"].
  const parts = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([a-zA-Z][\w-]*)|#([\w\\-]+)|\.([\w-]+)|\[([\w-]+)="([^"]*)"\]/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(selector))) {
    consumed += m[0].length;
    if (m[1]) parts.tag = m[1].toLowerCase();
    else if (m[2]) parts.id = m[2].replace(/\\/g, "");
    else if (m[3]) parts.classes.push(m[3]);
    else if (m[4]) parts.attrs.push([m[4], m[5]]);
  }
  if (consumed !== selector.length) throw new Error(`domstub: unsupported selector ${selector}`);
  return parts;
}

function matches(node, parts) {
  if (!(node instanceof StubElement)) return false;
  if (parts.tag && node.tagName.toLowerCase() !== parts.tag) return false;
  if (parts.id && node.id !== parts.id) return false;
  for (const cls of parts.classes) if (!node.classList.contains(cls)) return false;
  for (const [name, value] of parts.attrs) if (node.getAttribute(name) !== value) return false;
  return true;
}

class StubClassList {
  constructor(owner) {
    this._owner = owner;
  }
  _set() {
    return new Set((this._owner.className || "").split(/\s+/).filter(Boolean));
  }
  _write(set) {
    this._owner.className = [...set].join(" ");
  }
  add(...names) {
    const s = this._set();
    for (const n of names) s.add(n);
    this._write(s);
  }
  remove(...names) {
    const s = this._set();
    for (const n of names) s.delete(n);
    this._write(s);
  }
  contains(name) {
    return this._set().has(name);
  }
  toggle(name, force) {
    const s = this._set();
    const has = s.has(name);
    const want = force === undefined ? !has : force;
    if (want) s.add(name);
    else s.delete(name);
    this._write(s);
    return want;
  }
}

class StubElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.id = "";
    this._attrs = new Map();
    this._listeners = new Map();
    this.classList = new StubClassList(this);
    this.dataset = new Proxy(
      {},
      {
        set: (_t, key, value) => {
          this.setAttribute("data-" + String(key).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()), String(value));
          return true;
        },
        get: (_t, key) =>
          this.getAttribute("data-" + String(key).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())) ?? undefined,
      }
    );
    allElements.add(this);
  }

  get textContent() {
    return this.children.map((c) => (c instanceof StubElement ? c.textContent : c.text ?? "")).join("");
  }
  set textContent(value) {
    this.children = value === "" ? [] : [{ nodeType: 3, text: String(value) }];
  }

  setAttribute(name, value) {
    if (name === "id") this.id = String(value);
    else if (name === "class") this.className = String(value);
    else if (name === "style") this.style = String(value);
    else this._attrs.set(name, String(value));
  }
  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    return this._attrs.has(name) ? this._attrs.get(name) : null;
  }
  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  appendChild(child) {
    if (child instanceof StubElement) child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...nodes) {
    for (const n of nodes) this.appendChild(typeof n === "string" ? { nodeType: 3, text: n } : n);
  }
  prepend(...nodes) {
    for (const n of nodes.reverse()) {
      const node = typeof n === "string" ? { nodeType: 3, text: n } : n;
      if (node instanceof StubElement) node.parentNode = this;
      this.children.unshift(node);
    }
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i !== -1) this.children.splice(i, 1);
    if (child instanceof StubElement) child.parentNode = null;
    return child;
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const fns = this._listeners.get(type) || [];
    const i = fns.indexOf(fn);
    if (i !== -1) fns.splice(i, 1);
  }
  dispatchEvent(event) {
    let node = this;
    while (node) {
      for (const fn of node._listeners.get(event.type) || []) fn.call(node, event);
      if (!event.bubbles) break;
      node = node.parentNode;
    }
    return true;
  }
  click() {
    this.dispatchEvent({ type: "click", bubbles: true, target: this });
  }

  *walk() {
    for (const child of this.children) {
      if (child instanceof StubElement) {
        yield child;
        yield* child.walk();
      }
    }
  }
  querySelector(selector) {
    const parts = parseSelector(selector);
    for (const node of this.walk()) if (matches(node, parts)) return node;
    return null;
  }
  querySelectorAll(selector) {
    const parts = parseSelector(selector);
    return [...this.walk()].filter((node) => matches(node, parts));
  }
  scrollIntoView() {}
  focus() {}
}

export function installDom({ href = "http://localhost/" } = {}) {
  allElements.clear();
  const head = new StubElement("head");
  const body = new StubElement("body");
  const document = {
    head,
    body,
    createElement: (tag) => new StubElement(tag),
    createTextNode: (text) => ({ nodeType: 3, text: String(text) }),
    getElementById(id) {
      for (const node of allElements) if (node.id === id) return node;
      return null;
    },
    querySelector(selector) {
      return body.querySelector(selector) || head.querySelector(selector);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = document;
  globalThis.window = { location: { href, hash: "", search: "" }, crypto: globalThis.crypto, matchMedia: () => ({ matches: false }) };
  globalThis.CSS = { escape: (s) => String(s) };
  if (typeof globalThis.CustomEvent === "undefined") {
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, opts = {}) {
        this.type = type;
        this.detail = opts.detail;
        this.bubbles = !!opts.bubbles;
      }
    };
  }
  return { document, body, StubElement };
}

export { StubElement };
