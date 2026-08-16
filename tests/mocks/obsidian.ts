// Stand-in for the Obsidian API so tests can run outside the app.
// Extended in Stage 6 to cover the adapter + UI surface. Intentionally loose
// (`any` is fine here — this file is not linted); it models just enough
// behaviour for meaningful unit tests.

// ---- DOM helpers Obsidian augments onto HTMLElement ----

interface ElOptions {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean>;
  type?: string;
  href?: string;
  placeholder?: string;
  value?: string;
  title?: string;
}

function applyElOptions(el: HTMLElement, o: ElOptions): void {
  if (o.cls) el.classList.add(...(Array.isArray(o.cls) ? o.cls : [o.cls]));
  if (o.text !== undefined) el.textContent = o.text;
  if (o.type) el.setAttribute("type", o.type);
  if (o.href) el.setAttribute("href", o.href);
  if (o.placeholder) (el as HTMLInputElement).placeholder = o.placeholder;
  if (o.value !== undefined) (el as HTMLInputElement).value = o.value;
  if (o.title) el.setAttribute("title", o.title);
  if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, String(v));
}

function augmentHtmlElement(): void {
  const proto = HTMLElement.prototype as any;
  if (proto.__teAugmented) return;
  proto.__teAugmented = true;
  proto.createEl = function (tag: string, o: ElOptions = {}) {
    const el = document.createElement(tag);
    applyElOptions(el, o);
    this.appendChild(el);
    return el;
  };
  proto.createDiv = function (o: string | ElOptions = {}) {
    return this.createEl("div", typeof o === "string" ? { cls: o } : o);
  };
  proto.createSpan = function (o: string | ElOptions = {}) {
    return this.createEl("span", typeof o === "string" ? { cls: o } : o);
  };
  proto.empty = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  proto.setText = function (t: string) {
    this.textContent = t;
    return this;
  };
  proto.addClass = function (...c: string[]) {
    this.classList.add(...c);
    return this;
  };
  proto.removeClass = function (...c: string[]) {
    this.classList.remove(...c);
    return this;
  };
  proto.toggleClass = function (c: string, on?: boolean) {
    this.classList.toggle(c, on);
    return this;
  };
  proto.setAttr = function (k: string, v: any) {
    this.setAttribute(k, String(v));
    return this;
  };
}
augmentHtmlElement();

// ---- Files ----

export class TFolder {
  path = "";
  name = "";
  children: any[] = [];
  parent: TFolder | null = null;
}

export class TFile {
  path = "";
  name = "";
  basename = "";
  extension = "md";
  parent: TFolder | null = null;
  constructor(path?: string) {
    if (path) {
      this.path = path;
      this.name = path.slice(path.lastIndexOf("/") + 1);
      const dot = this.name.lastIndexOf(".");
      this.basename = dot === -1 ? this.name : this.name.slice(0, dot);
      this.extension = dot === -1 ? "" : this.name.slice(dot + 1);
    }
  }
}

// ---- Vault / metadata / app ----

export class Vault {
  notes = new Map<string, string>();
  binaries = new Map<string, ArrayBuffer>();
  created = new Map<string, string | ArrayBuffer>();

  fileFor(path: string): TFile {
    const f = new TFile(path);
    return f;
  }
  getAbstractFileByPath(path: string): TFile | null {
    if (this.notes.has(path) || this.binaries.has(path) || this.created.has(path)) return this.fileFor(path);
    return null;
  }
  async read(file: TFile): Promise<string> {
    return this.notes.get(file.path) ?? "";
  }
  async cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }
  async readBinary(file: TFile): Promise<ArrayBuffer> {
    return this.binaries.get(file.path) ?? new ArrayBuffer(0);
  }
  async create(path: string, data: string): Promise<TFile> {
    this.created.set(path, data);
    return this.fileFor(path);
  }
  async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
    this.created.set(path, data);
    return this.fileFor(path);
  }
  folders = new Set<string>();
  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }
  getMarkdownFiles(): TFile[] {
    return [...this.notes.keys()].filter((p) => p.endsWith(".md")).map((p) => this.fileFor(p));
  }
}

export class MetadataCache {
  resolver: (linkpath: string, source: string) => string | null = () => null;
  getFirstLinkpathDest(linkpath: string, source: string): TFile | null {
    const path = this.resolver(linkpath, source);
    return path ? new TFile(path) : null;
  }
}

export class Workspace {
  activeFile: TFile | null = null;
  handlers = new Map<string, Function[]>();
  getActiveFile(): TFile | null {
    return this.activeFile;
  }
  on(name: string, cb: Function): { name: string; cb: Function } {
    const list = this.handlers.get(name) ?? [];
    list.push(cb);
    this.handlers.set(name, list);
    return { name, cb };
  }
  trigger(name: string, ...args: any[]): void {
    for (const cb of this.handlers.get(name) ?? []) cb(...args);
  }
}

export class App {
  vault = new Vault();
  metadataCache = new MetadataCache();
  workspace = new Workspace();
}

// ---- Notices (captured for assertions) ----

export const noticeLog: string[] = [];
export class Notice {
  constructor(public message: string, public timeout?: number) {
    noticeLog.push(message);
  }
  setMessage(m: string) {
    this.message = m;
    return this;
  }
  hide() {}
}

// ---- Menu ----

export class MenuItem {
  title = "";
  icon = "";
  disabled = false;
  onClickCb?: () => void;
  setTitle(t: string) {
    this.title = t;
    return this;
  }
  setIcon(i: string) {
    this.icon = i;
    return this;
  }
  setDisabled(d: boolean) {
    this.disabled = d;
    return this;
  }
  onClick(cb: () => void) {
    this.onClickCb = cb;
    return this;
  }
}
export class Menu {
  items: MenuItem[] = [];
  addItem(cb: (item: MenuItem) => void) {
    const item = new MenuItem();
    cb(item);
    this.items.push(item);
    return this;
  }
  showAtMouseEvent() {}
  showAtPosition() {}
}

// ---- Plugin base ----

export class Plugin {
  app: App;
  manifest: any;
  commands: any[] = [];
  ribbons: any[] = [];
  settingTabs: any[] = [];
  events: any[] = [];
  private data: any = {};
  constructor(app?: App, manifest?: any) {
    this.app = app ?? new App();
    this.manifest = manifest ?? {};
  }
  addCommand(cmd: any) {
    this.commands.push(cmd);
    return cmd;
  }
  addRibbonIcon(icon: string, title: string, cb: (e: MouseEvent) => void) {
    const el = document.createElement("div");
    this.ribbons.push({ icon, title, cb, el });
    return el;
  }
  addSettingTab(tab: any) {
    this.settingTabs.push(tab);
  }
  registerEvent(ref: any) {
    this.events.push(ref);
  }
  registerDomEvent(el: HTMLElement, ev: string, cb: any) {
    el.addEventListener(ev, cb);
  }
  register(_cb: () => void) {}
  async loadData() {
    return this.data;
  }
  async saveData(d: any) {
    this.data = d;
  }
}

// ---- Modal ----

export class Modal {
  app: App;
  containerEl: HTMLElement = document.createElement("div");
  contentEl: HTMLElement = document.createElement("div");
  scope = { register: (_m: any, _k: any, _cb: any) => {} };
  isOpen = false;
  constructor(app: App) {
    this.app = app;
  }
  open() {
    this.isOpen = true;
    this.onOpen();
  }
  close() {
    this.isOpen = false;
    this.onClose();
    this.contentEl.empty();
  }
  onOpen() {}
  onClose() {}
  setTitle(t: string) {
    this.titleText = t;
    return this;
  }
  titleText = "";
}

// ---- Settings tab + components ----

export class PluginSettingTab {
  app: App;
  plugin: any;
  containerEl: HTMLElement = document.createElement("div");
  constructor(app: App, plugin: any) {
    this.app = app;
    this.plugin = plugin;
  }
  display() {}
  hide() {}
}

class ValueComponent<T> {
  value!: T;
  disabled = false;
  changeCb?: (v: T) => void;
  setValue(v: T) {
    this.value = v;
    return this;
  }
  getValue() {
    return this.value;
  }
  onChange(cb: (v: T) => void) {
    this.changeCb = cb;
    return this;
  }
  setDisabled(d: boolean) {
    this.disabled = d;
    return this;
  }
  /** Test helper: simulate a user change. */
  triggerChange(v: T) {
    this.value = v;
    this.changeCb?.(v);
  }
}

export class TextComponent extends ValueComponent<string> {
  inputEl = document.createElement("input");
  setPlaceholder(p: string) {
    this.inputEl.placeholder = p;
    return this;
  }
  setValue(v: string) {
    super.setValue(v);
    this.inputEl.value = v;
    return this;
  }
  onChange(cb: (v: string) => void) {
    super.onChange(cb);
    this.inputEl.addEventListener("input", () => cb(this.inputEl.value));
    return this;
  }
  setDisabled(d: boolean) {
    super.setDisabled(d);
    this.inputEl.disabled = d;
    return this;
  }
}

export class ToggleComponent extends ValueComponent<boolean> {
  setTooltip() {
    return this;
  }
}

export class DropdownComponent extends ValueComponent<string> {
  selectEl = document.createElement("select");
  options: Record<string, string> = {};
  addOption(v: string, label: string) {
    this.options[v] = label;
    const o = document.createElement("option");
    o.value = v;
    o.text = label;
    this.selectEl.appendChild(o);
    return this;
  }
  addOptions(rec: Record<string, string>) {
    for (const [v, l] of Object.entries(rec)) this.addOption(v, l);
    return this;
  }
  setValue(v: string) {
    super.setValue(v);
    this.selectEl.value = v;
    return this;
  }
  onChange(cb: (v: string) => void) {
    super.onChange(cb);
    this.selectEl.addEventListener("change", () => cb(this.selectEl.value));
    return this;
  }
  setDisabled(d: boolean) {
    super.setDisabled(d);
    this.selectEl.disabled = d;
    return this;
  }
}

export class ButtonComponent {
  buttonEl: HTMLButtonElement;
  disabled = false;
  clickCb?: () => void;
  constructor(parent?: HTMLElement) {
    this.buttonEl = document.createElement("button");
    if (parent) parent.appendChild(this.buttonEl);
  }
  setButtonText(t: string) {
    this.buttonEl.textContent = t;
    return this;
  }
  setCta() {
    this.buttonEl.classList.add("mod-cta");
    return this;
  }
  setWarning() {
    return this;
  }
  setIcon() {
    return this;
  }
  setTooltip() {
    return this;
  }
  setDisabled(d: boolean) {
    this.disabled = d;
    this.buttonEl.disabled = d;
    return this;
  }
  onClick(cb: () => void) {
    this.clickCb = cb;
    this.buttonEl.addEventListener("click", cb);
    return this;
  }
}

export class ExtraButtonComponent extends ButtonComponent {}

export class Setting {
  settingEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  components: any[] = [];
  constructor(containerEl: HTMLElement) {
    this.settingEl = (containerEl as any).createDiv("setting-item");
    const info = (this.settingEl as any).createDiv("setting-item-info");
    this.nameEl = (info as any).createDiv("setting-item-name");
    this.descEl = (info as any).createDiv("setting-item-description");
    this.controlEl = (this.settingEl as any).createDiv("setting-item-control");
  }
  setName(n: string) {
    this.nameEl.textContent = n;
    return this;
  }
  setDesc(d: string | DocumentFragment) {
    if (typeof d === "string") this.descEl.textContent = d;
    else this.descEl.appendChild(d);
    return this;
  }
  setHeading() {
    this.settingEl.classList.add("setting-item-heading");
    return this;
  }
  setClass(c: string) {
    this.settingEl.classList.add(c);
    return this;
  }
  addText(cb: (c: TextComponent) => void) {
    const c = new TextComponent();
    this.controlEl.appendChild(c.inputEl);
    cb(c);
    this.components.push(c);
    return this;
  }
  addToggle(cb: (c: ToggleComponent) => void) {
    const c = new ToggleComponent();
    cb(c);
    this.components.push(c);
    return this;
  }
  addDropdown(cb: (c: DropdownComponent) => void) {
    const c = new DropdownComponent();
    this.controlEl.appendChild(c.selectEl);
    cb(c);
    this.components.push(c);
    return this;
  }
  addButton(cb: (c: ButtonComponent) => void) {
    const c = new ButtonComponent(this.controlEl);
    cb(c);
    this.components.push(c);
    return this;
  }
  addExtraButton(cb: (c: ExtraButtonComponent) => void) {
    const c = new ExtraButtonComponent(this.controlEl);
    cb(c);
    this.components.push(c);
    return this;
  }
}

// ---- misc ----

export function setIcon(el: HTMLElement, icon: string): void {
  el.setAttribute("data-icon", icon);
}

// requestUrl with a settable handler so createRemoteImageFetcher is testable.
interface RequestUrlResponse {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  text: string;
}
let requestUrlHandler: (opts: any) => Promise<RequestUrlResponse> = async () => ({
  status: 200,
  headers: {},
  arrayBuffer: new ArrayBuffer(0),
  text: "",
});
export function setRequestUrlHandler(h: (opts: any) => Promise<RequestUrlResponse>): void {
  requestUrlHandler = h;
}
export function requestUrl(opts: any): Promise<RequestUrlResponse> {
  return requestUrlHandler(opts);
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

export const Platform = {
  isMobile: false,
  isDesktop: true,
  isIosApp: false,
  isAndroidApp: false,
};
