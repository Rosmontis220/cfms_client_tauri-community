/**
 * 小工具 — community plugin page.
 *
 * The host mounts this document into an open shadow root and then evaluates the
 * bundled script inside `new Function('root', 'pluginId', code)`, so this module
 * exports `mount(root, pluginId)` and builds every panel by iterating the
 * `TOOLS` registry — no panel is hand-written, so adding a tool to the registry
 * adds a tab to the UI.
 *
 * Behaviour mirrors the host application's Svelte page
 * (`src/routes/home/tools/+page.svelte`): panel state survives tab switches,
 * `symmetric` tools run the same function from both buttons, tools without a
 * `decode` show a single 计算 action, and a tool error is shown inside the panel
 * instead of escaping the click handler.
 *
 * Nothing is persisted, nothing is fetched, and no host API is called: the
 * plugin declares no capabilities because it is pure computation.
 */

import { ToolError } from './errors';
import { matrixDecode, matrixEncode, matrixTranspose } from './matrix';
import { MATRIX_TOOL_ID, TOOLS, type ToolDefinition, type ToolFunction } from './registry';
import { t, tError } from './labels';

/** Identifies the plugin when a host forgets to pass its id. */
const FALLBACK_PLUGIN_ID = 'org.cfms.tools';

/** Matrix grid is 7×7, matching `matrixEncode` / `matrixDecode`. */
const MATRIX_SIZE = 7;

/** Defaults taken from the host page; the matrix tool is a puzzle generator. */
const MATRIX_DEFAULT_PORT = '7573';
const MATRIX_DEFAULT_REVISION = '1';
const MATRIX_DEFAULT_DECOY_KEY = '726791';

/** Roots that already carry a mounted UI, so mounting twice is a no-op. */
const mountedRoots = new WeakSet<ShadowRoot>();

type KeyField = HTMLInputElement | HTMLSelectElement;

interface MatrixPanel {
  section: HTMLElement;
  ip: HTMLInputElement;
  port: HTMLInputElement;
  revision: HTMLInputElement;
  decoyKey: HTMLInputElement;
  cells: HTMLInputElement[];
  result: HTMLElement;
  error: HTMLElement;
}

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Read a required part of the page shell, failing loudly when it is absent. */
function requiredRole(root: ShadowRoot, role: string): HTMLElement {
  const node = root.querySelector<HTMLElement>(`[data-role="${role}"]`);
  if (!node) {
    throw new Error(`小工具: page shell is missing [data-role="${role}"]`);
  }
  return node;
}

/** Turn anything a tool threw into a zh-CN message. */
function formatError(error: unknown): string {
  if (error instanceof ToolError) return tError(error.key, error.params);
  if (error instanceof Error) return error.message;
  return String(error);
}

function showError(node: HTMLElement, message: string | null): void {
  node.textContent = message ?? '';
  node.hidden = message === null;
}

function labelledField(labelText: string, control: HTMLElement, className: string): HTMLLabelElement {
  const label = element('label', className);
  label.append(element('span', undefined, labelText), control);
  return label;
}

// ---------------------------------------------------------------------------
// Generic tool panel
// ---------------------------------------------------------------------------

function buildToolPanel(tool: ToolDefinition, panelId: string): {
  section: HTMLElement;
  input: HTMLTextAreaElement;
  keyFields: KeyField[];
  output: HTMLTextAreaElement;
  error: HTMLElement;
} {
  const section = element('section', 'tools-card tool-panel');
  section.id = panelId;
  section.dataset.role = 'panel';
  section.setAttribute('role', 'tabpanel');
  section.setAttribute('aria-label', tool.label);
  section.hidden = true;

  section.append(element('p', 'tools-hint', tool.hint));

  const keyFields: KeyField[] = [];
  if (tool.keySpecs.length > 0) {
    const keys = element('div', 'tool-keys');
    for (const spec of tool.keySpecs) {
      let field: KeyField;
      if (spec.options) {
        const select = element('select');
        for (const option of spec.options) {
          const node = element('option', undefined, option);
          node.value = option;
          select.append(node);
        }
        select.value = spec.defaultValue;
        field = select;
      } else {
        const input = element('input');
        input.type = 'text';
        input.spellcheck = false;
        input.value = spec.defaultValue;
        field = input;
      }
      field.dataset.role = 'key';
      keyFields.push(field);
      keys.append(labelledField(spec.label, field, 'tool-key'));
    }
    section.append(keys);
  }

  const inputId = `tool-input-${tool.id}`;
  const inputLabel = element('label', 'tool-textarea-label', t('tools.labels.input'));
  inputLabel.htmlFor = inputId;
  const input = element('textarea', 'tool-textarea');
  input.id = inputId;
  input.dataset.role = 'input';
  input.rows = 6;
  input.spellcheck = false;
  section.append(inputLabel, input);

  const actions = element('div', 'tools-actions');
  const output = element('textarea', 'tool-textarea');
  const error = element('p', 'tools-error');
  error.dataset.role = 'error';
  error.setAttribute('role', 'alert');
  error.hidden = true;

  // `symmetric` means encode is its own inverse (Atbash), so both buttons are
  // wired to the same function rather than to `decode`.
  const encodeAction: ToolFunction = tool.encode;
  const decodeAction: ToolFunction | undefined = tool.symmetric ? tool.encode : tool.decode;

  if (decodeAction) {
    const encodeButton = element('button', 'tools-button tools-button--primary', t('tools.actions.encode'));
    encodeButton.type = 'button';
    encodeButton.dataset.action = 'encode';
    encodeButton.addEventListener('click', () => runTool(encodeAction, input, keyFields, output, error));

    const decodeButton = element('button', 'tools-button', t('tools.actions.decode'));
    decodeButton.type = 'button';
    decodeButton.dataset.action = 'decode';
    decodeButton.addEventListener('click', () => runTool(decodeAction, input, keyFields, output, error));

    actions.append(encodeButton, decodeButton);
  } else {
    const computeButton = element('button', 'tools-button tools-button--primary', t('tools.actions.compute'));
    computeButton.type = 'button';
    computeButton.dataset.action = 'compute';
    computeButton.addEventListener('click', () => runTool(encodeAction, input, keyFields, output, error));
    actions.append(computeButton);
  }

  const copyButton = element('button', 'tools-button', t('tools.actions.copy'));
  copyButton.type = 'button';
  copyButton.dataset.action = 'copy';
  copyButton.addEventListener('click', () => void copyOutput(output));

  const clearButton = element('button', 'tools-button', t('tools.actions.clear'));
  clearButton.type = 'button';
  clearButton.dataset.action = 'clear';
  clearButton.addEventListener('click', () => {
    input.value = '';
    output.value = '';
    showError(error, null);
  });

  actions.append(copyButton, clearButton);
  section.append(actions);

  const outputId = `tool-output-${tool.id}`;
  const outputLabel = element('label', 'tool-textarea-label', t('tools.labels.output'));
  outputLabel.htmlFor = outputId;
  output.id = outputId;
  output.dataset.role = 'output';
  output.rows = 6;
  output.readOnly = true;
  output.spellcheck = false;
  section.append(outputLabel, output, error);

  return { section, input, keyFields, output, error };
}

/**
 * Run a tool function, showing whatever it throws inside the panel.
 *
 * The output keeps its previous value when the tool fails, matching the host
 * page: a failed decode must not silently blank the last good result.
 */
function runTool(
  fn: ToolFunction,
  input: HTMLTextAreaElement,
  keyFields: KeyField[],
  output: HTMLTextAreaElement,
  error: HTMLElement,
): void {
  try {
    const keys = keyFields.map((field) => field.value);
    output.value = fn(input.value, keys);
    showError(error, null);
  } catch (cause) {
    showError(error, formatError(cause));
  }
}

/** Copying can fail in an embedded webview where the clipboard is unavailable. */
async function copyOutput(output: HTMLTextAreaElement): Promise<void> {
  const text = output.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard access is not guaranteed; ignore rather than break the panel.
  }
}

// ---------------------------------------------------------------------------
// Matrix panel
// ---------------------------------------------------------------------------

function buildMatrixPanel(): MatrixPanel {
  const section = element('section', 'tools-card matrix-panel');
  section.id = `tools-panel-${MATRIX_TOOL_ID}`;
  section.dataset.role = 'panel';
  section.setAttribute('role', 'tabpanel');
  section.setAttribute('aria-label', t('tools.matrix.title'));
  section.hidden = true;

  section.append(element('p', 'tools-hint', t('tools.matrix.hint')));

  const fields = element('div', 'matrix-fields');
  const ip = element('input');
  ip.type = 'text';
  ip.placeholder = '192.168.1.100';
  ip.spellcheck = false;

  const port = element('input');
  port.type = 'text';
  port.inputMode = 'numeric';
  port.spellcheck = false;
  port.value = MATRIX_DEFAULT_PORT;

  const revision = element('input');
  revision.type = 'text';
  revision.inputMode = 'numeric';
  revision.spellcheck = false;
  revision.value = MATRIX_DEFAULT_REVISION;

  const decoyKey = element('input');
  decoyKey.type = 'text';
  decoyKey.spellcheck = false;
  decoyKey.value = MATRIX_DEFAULT_DECOY_KEY;

  ip.dataset.role = 'matrix-ip';
  port.dataset.role = 'matrix-port';
  revision.dataset.role = 'matrix-revision';
  decoyKey.dataset.role = 'matrix-decoy-key';

  fields.append(
    labelledField(t('tools.matrix.ip'), ip, 'matrix-field'),
    labelledField(t('tools.matrix.port'), port, 'matrix-field'),
    labelledField(t('tools.matrix.revision'), revision, 'matrix-field'),
    labelledField(t('tools.matrix.decoyKey'), decoyKey, 'matrix-field'),
  );

  const grid = element('div', 'matrix-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', t('tools.matrix.title'));
  const cells: HTMLInputElement[] = [];
  for (let row = 0; row < MATRIX_SIZE; row++) {
    for (let column = 0; column < MATRIX_SIZE; column++) {
      const cell = element('input', 'matrix-cell');
      cell.type = 'text';
      cell.dataset.role = 'matrix-cell';
      cell.maxLength = 1;
      cell.inputMode = 'numeric';
      cell.spellcheck = false;
      cell.setAttribute('aria-label', t('tools.matrix.cell', { row: row + 1, col: column + 1 }));
      cells.push(cell);
      grid.append(cell);
    }
  }

  const error = element('p', 'tools-error');
  error.dataset.role = 'matrix-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;

  const result = element('p', 'matrix-result');
  result.hidden = true;

  const panel = { section, ip, port, revision, decoyKey, cells, result, error };
  const actions = element('div', 'tools-actions');

  const generateButton = element('button', 'tools-button tools-button--primary', t('tools.matrix.generate'));
  generateButton.type = 'button';
  generateButton.dataset.action = 'generate';
  generateButton.addEventListener('click', () => matrixGenerate(panel));

  const decodeButton = element('button', 'tools-button', t('tools.matrix.decode'));
  decodeButton.type = 'button';
  decodeButton.dataset.action = 'decode';
  decodeButton.addEventListener('click', () => matrixDecodeAction(panel));

  const transposeButton = element('button', 'tools-button', t('tools.matrix.transpose'));
  transposeButton.type = 'button';
  transposeButton.dataset.action = 'transpose';
  transposeButton.addEventListener('click', () => matrixTransposeAction(panel));

  const clearButton = element('button', 'tools-button', t('tools.matrix.clear'));
  clearButton.type = 'button';
  clearButton.dataset.action = 'clear';
  clearButton.addEventListener('click', () => {
    for (const cell of panel.cells) cell.value = '';
    panel.result.hidden = true;
    panel.result.textContent = '';
    showError(panel.error, null);
  });

  actions.append(generateButton, decodeButton, transposeButton, clearButton);

  section.append(fields, actions, grid, error, result);
  return panel;
}

/** Read the grid, rejecting anything that is not a single digit. */
function readMatrix(panel: MatrixPanel): number[][] {
  const rows: number[][] = [];
  for (let row = 0; row < MATRIX_SIZE; row++) {
    const values: number[] = [];
    for (let column = 0; column < MATRIX_SIZE; column++) {
      const cell = panel.cells[row * MATRIX_SIZE + column].value.trim();
      if (!/^\d$/.test(cell)) throw new ToolError('matrix.digits');
      values.push(parseInt(cell, 10));
    }
    rows.push(values);
  }
  return rows;
}

function writeMatrix(panel: MatrixPanel, values: number[][]): void {
  for (let row = 0; row < MATRIX_SIZE; row++) {
    for (let column = 0; column < MATRIX_SIZE; column++) {
      panel.cells[row * MATRIX_SIZE + column].value = String(values[row][column]);
    }
  }
}

function showMatrixResult(panel: MatrixPanel, text: string | null, ok = true): void {
  if (text === null) {
    panel.result.hidden = true;
    panel.result.textContent = '';
    panel.result.classList.remove('matrix-result--invalid');
    return;
  }
  panel.result.hidden = false;
  panel.result.textContent = text;
  panel.result.classList.toggle('matrix-result--invalid', !ok);
}

function matrixGenerate(panel: MatrixPanel): void {
  showError(panel.error, null);
  try {
    const ip = panel.ip.value.trim();
    const portText = panel.port.value.trim();
    const revisionText = panel.revision.value.trim() || MATRIX_DEFAULT_REVISION;
    const decoyKey = panel.decoyKey.value.trim() || MATRIX_DEFAULT_DECOY_KEY;
    if (!/^[+-]?\d+$/.test(portText)) throw new ToolError('ciphers.integer');
    if (!/^[+-]?\d+$/.test(revisionText)) throw new ToolError('ciphers.integer');
    const port = parseInt(portText, 10);
    const revision = parseInt(revisionText, 10);
    writeMatrix(panel, matrixEncode(ip, port, revision, decoyKey));
    showMatrixResult(panel, t('tools.matrix.generated'), true);
  } catch (cause) {
    showError(panel.error, formatError(cause));
  }
}

function matrixDecodeAction(panel: MatrixPanel): void {
  showError(panel.error, null);
  try {
    const info = matrixDecode(readMatrix(panel));
    const rbf = info.rbfClass === null ? t('tools.matrix.uncertain') : String(info.rbfClass);
    showMatrixResult(
      panel,
      `${t('tools.matrix.endpoint')} ${info.endpoint}\n`
        + `${t('tools.matrix.checksum')} ${info.checksum}`
        + `  |  ${t('tools.matrix.rbf')}${rbf}`
        + ` (${t('tools.matrix.distance')} ${info.rbfDistance})\n`
        + (info.valid ? t('tools.matrix.valid') : t('tools.matrix.invalid')),
      info.valid,
    );
  } catch (cause) {
    showError(panel.error, formatError(cause));
  }
}

function matrixTransposeAction(panel: MatrixPanel): void {
  showError(panel.error, null);
  try {
    writeMatrix(panel, matrixTranspose(readMatrix(panel)));
    showMatrixResult(panel, null);
  } catch (cause) {
    showError(panel.error, formatError(cause));
  }
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

/**
 * Build the 小工具 UI inside `root`.
 *
 * Idempotent: a host that both evaluates the bundle (which mounts itself, see
 * below) and appends `ComExtPlugin.mount(root, pluginId)` still gets one UI.
 */
export function mount(root: ShadowRoot, pluginId: string): void {
  const host = requiredRole(root, 'tools-page');
  if (mountedRoots.has(root)) return;

  const tabsHost = requiredRole(root, 'tabs');
  const panelsHost = requiredRole(root, 'panels');

  const title = root.querySelector<HTMLElement>('[data-role="title"]');
  if (title) title.textContent = t('tools.title');
  const description = root.querySelector<HTMLElement>('[data-role="description"]');
  if (description) description.textContent = t('tools.description');

  host.dataset.pluginId = typeof pluginId === 'string' && pluginId ? pluginId : FALLBACK_PLUGIN_ID;

  const tabs = new Map<string, HTMLButtonElement>();
  const sections = new Map<string, HTMLElement>();

  function activate(id: string): void {
    for (const [key, tab] of tabs) {
      const active = key === id;
      tab.classList.toggle('tools-tab--active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
      const section = sections.get(key);
      if (section) section.hidden = !active;
    }
  }

  function addTab(id: string, label: string, section: HTMLElement): void {
    const tab = element('button', 'tools-tab');
    tab.type = 'button';
    tab.id = `tools-tab-${id}`;
    tab.dataset.tool = id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', section.id);
    tab.setAttribute('aria-selected', 'false');
    tab.tabIndex = -1;
    tab.append(element('span', undefined, label));
    tab.addEventListener('click', () => activate(id));
    tabs.set(id, tab);
    sections.set(id, section);
    tabsHost.append(tab);
    panelsHost.append(section);
  }

  // The matrix tool leads the strip, matching the host page's tab order.
  const matrix = buildMatrixPanel();
  addTab(MATRIX_TOOL_ID, t('tools.matrix.title'), matrix.section);

  for (const tool of TOOLS) {
    const panel = buildToolPanel(tool, `tools-panel-${tool.id}`);
    addTab(tool.id, tool.label, panel.section);
  }

  activate(MATRIX_TOOL_ID);
  mountedRoots.add(root);
}

// The host evaluates this bundle as the body of `new Function('root',
// 'pluginId', code)`, which leaves both names in scope as free variables. Some
// hosts also append `ComExtPlugin.mount(root, pluginId);` to that body. Mounting
// from here covers the first shape, and `mount` is idempotent so the second
// shape is a no-op rather than a double render.
declare const root: ShadowRoot | undefined;
declare const pluginId: string | undefined;

if (typeof root !== 'undefined' && root !== null && typeof root.querySelector === 'function') {
  mount(root, typeof pluginId === 'string' ? pluginId : FALLBACK_PLUGIN_ID);
}
