/**
 * Registry describing every utility in the 小工具 community plugin page.
 *
 * Copied from the host application's `src/lib/tools/registry.ts`
 * (which mirrors the tab list in CFMS工具箱_v1.10.0.pyw, `CryptoPanel._build_ui`).
 *
 * The only change is label resolution: the host page stored i18n *keys* and
 * resolved them through svelte-i18n at render time, but a plugin page lives in
 * a shadow root with no access to the host's i18n runtime. The keys are
 * therefore resolved once, eagerly, through the plugin's own `labels.ts`, and
 * the registry exposes plain zh-CN strings.
 *
 * `encode`/`decode` receive the raw text plus the current key values and return
 * the transformed text; they may throw `ToolError`.
 */

import {
  a1z26Decode,
  a1z26Encode,
  adfgvxDecode,
  adfgvxEncode,
  asciiDecode,
  asciiEncode,
  atbash,
  baconianDecode,
  baconianEncode,
  caesarDecode,
  caesarEncode,
  keywordDecode,
  keywordEncode,
  morseDecode,
  morseEncode,
  radixDecode,
  radixEncode,
  sha256Tool,
  simpleDecode,
  simpleEncode,
  vigenereDecode,
  vigenereEncode,
} from './ciphers';
import { baseDecode, baseEncode, BASE_CODECS } from './base';
import { encodingDecode, encodingEncode, ENCODING_OPTIONS } from './encodings';
import { t } from './labels';

export interface ToolKeySpec {
  /** zh-CN label shown above the key input. */
  label: string;
  defaultValue: string;
  options?: readonly string[];
}

export type ToolFunction = (text: string, keys: string[]) => string;

export interface ToolDefinition {
  id: string;
  /** zh-CN tab label. */
  label: string;
  /** zh-CN one-line explanation shown at the top of the panel. */
  hint: string;
  keySpecs: ToolKeySpec[];
  encode: ToolFunction;
  /** When absent the tool is single-action (e.g. "计算" for SHA-256). */
  decode?: ToolFunction;
  /** When encode is idempotent (Atbash) both buttons call the same function. */
  symmetric?: boolean;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'ascii',
    label: t('tools.tabs.ascii'),
    hint: t('tools.hints.ascii'),
    keySpecs: [],
    encode: (_text, keys) => asciiEncode(_text),
    decode: (_text) => asciiDecode(_text),
  },
  {
    id: 'a1z26',
    label: t('tools.tabs.a1z26'),
    hint: t('tools.hints.a1z26'),
    keySpecs: [],
    encode: (text) => a1z26Encode(text),
    decode: (text) => a1z26Decode(text),
  },
  {
    id: 'radix',
    label: t('tools.tabs.radix'),
    hint: t('tools.hints.radix'),
    keySpecs: [
      { label: t('tools.keys.sourceRadix'), defaultValue: '10' },
      { label: t('tools.keys.targetRadix'), defaultValue: '16' },
    ],
    encode: (text, keys) => radixEncode(text, keys[0], keys[1]),
    decode: (text, keys) => radixDecode(text, keys[0], keys[1]),
  },
  {
    id: 'base',
    label: t('tools.tabs.base'),
    hint: t('tools.hints.base'),
    keySpecs: [{ label: t('tools.keys.baseCodec'), defaultValue: 'BASE64', options: BASE_CODECS }],
    encode: (text, keys) => baseEncode(text, keys[0]),
    decode: (text, keys) => baseDecode(text, keys[0]),
  },
  {
    id: 'morse',
    label: t('tools.tabs.morse'),
    hint: t('tools.hints.morse'),
    keySpecs: [],
    encode: (text) => morseEncode(text),
    decode: (text) => morseDecode(text),
  },
  {
    id: 'baconian',
    label: t('tools.tabs.baconian'),
    hint: t('tools.hints.baconian'),
    keySpecs: [],
    encode: (text) => baconianEncode(text),
    decode: (text) => baconianDecode(text),
  },
  {
    id: 'caesar',
    label: t('tools.tabs.caesar'),
    hint: t('tools.hints.caesar'),
    keySpecs: [{ label: t('tools.keys.caesarShift'), defaultValue: '3' }],
    encode: (text, keys) => caesarEncode(text, keys[0]),
    decode: (text, keys) => caesarDecode(text, keys[0]),
  },
  {
    id: 'atbash',
    label: t('tools.tabs.atbash'),
    hint: t('tools.hints.atbash'),
    keySpecs: [],
    encode: (text) => atbash(text),
    decode: (text) => atbash(text),
    symmetric: true,
  },
  {
    id: 'vigenere',
    label: t('tools.tabs.vigenere'),
    hint: t('tools.hints.vigenere'),
    keySpecs: [{ label: t('tools.keys.secretKey'), defaultValue: '' }],
    encode: (text, keys) => vigenereEncode(text, keys[0]),
    decode: (text, keys) => vigenereDecode(text, keys[0]),
  },
  {
    id: 'keyword',
    label: t('tools.tabs.keyword'),
    hint: t('tools.hints.keyword'),
    keySpecs: [{ label: t('tools.keys.secretKey'), defaultValue: '' }],
    encode: (text, keys) => keywordEncode(text, keys[0]),
    decode: (text, keys) => keywordDecode(text, keys[0]),
  },
  {
    id: 'simple',
    label: t('tools.tabs.simple'),
    hint: t('tools.hints.simple'),
    keySpecs: [{ label: t('tools.keys.substitutionAlphabet'), defaultValue: '' }],
    encode: (text, keys) => simpleEncode(text, keys[0]),
    decode: (text, keys) => simpleDecode(text, keys[0]),
  },
  {
    id: 'adfgvx',
    label: t('tools.tabs.adfgvx'),
    hint: t('tools.hints.adfgvx'),
    keySpecs: [
      { label: t('tools.keys.secretKey'), defaultValue: '' },
      { label: t('tools.keys.adfgvxSquare'), defaultValue: '' },
    ],
    encode: (text, keys) => adfgvxEncode(text, keys[0], keys[1]),
    decode: (text, keys) => adfgvxDecode(text, keys[0], keys[1]),
  },
  {
    id: 'encoding',
    label: t('tools.tabs.encoding'),
    hint: t('tools.hints.encoding'),
    keySpecs: [
      { label: t('tools.keys.sourceEncoding'), defaultValue: 'UTF-8', options: ENCODING_OPTIONS },
      { label: t('tools.keys.targetEncoding'), defaultValue: 'GBK', options: ENCODING_OPTIONS },
    ],
    encode: (text, keys) => encodingEncode(text, keys),
    decode: (text, keys) => encodingDecode(text, keys),
  },
  {
    id: 'sha256',
    label: t('tools.tabs.sha256'),
    hint: t('tools.hints.sha256'),
    keySpecs: [],
    encode: (text) => sha256Tool(text),
  },
];

/** The matrix tool is rendered by a dedicated panel, not the generic tabs. */
export const MATRIX_TOOL_ID = 'matrix';
