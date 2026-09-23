/**
 * zh-CN strings for the 小工具 community plugin.
 *
 * These are extracted verbatim from the host application's zh-CN catalogue
 * (`src/lib/i18n/messages/zh-CN.ts`, namespace `tools`). The keys are kept
 * identical to the ones the built-in page used (`tools.tabs.*`, `tools.keys.*`,
 * `tools.hints.*`, `tools.errors.*`, …) so the registry — and the error keys
 * thrown by the cipher implementations — keep working unchanged.
 *
 * A community plugin runs inside a shadow root and cannot reach the host's
 * i18n runtime, so the strings ship with the plugin and are resolved locally.
 */

/** Flat `dotted.key -> 中文` map, mirroring the host's `tools` namespace. */
export const LABELS: Readonly<Record<string, string>> = {
  'tools.title': '小工具',
  'tools.description': '解谜相关的常用小工具',

  'tools.matrix.title': '矩阵生成',
  'tools.matrix.hint': '把 IP 与端口编码为 7×7 谜题矩阵（含干扰数据），也可解码还原与转置。',
  'tools.matrix.ip': 'IP 地址：',
  'tools.matrix.port': '端口：',
  'tools.matrix.revision': '修订：',
  'tools.matrix.decoyKey': '干扰密钥：',
  'tools.matrix.generate': '生成矩阵',
  'tools.matrix.decode': '解码',
  'tools.matrix.transpose': '转置',
  'tools.matrix.clear': '清空',
  'tools.matrix.generated': '已生成 7×7 矩阵。',
  'tools.matrix.endpoint': '端点：',
  'tools.matrix.checksum': '校验和：',
  'tools.matrix.rbf': 'RBF：',
  'tools.matrix.distance': '距离',
  'tools.matrix.valid': '校验结果：有效',
  'tools.matrix.invalid': '校验结果：无效',
  'tools.matrix.uncertain': '不确定',
  'tools.matrix.cell': '第 {row} 行第 {col} 列',

  'tools.tabs.ascii': 'ASCII',
  'tools.tabs.a1z26': 'A1Z26',
  'tools.tabs.radix': '进制转换',
  'tools.tabs.base': 'BASE',
  'tools.tabs.morse': '摩斯电码',
  'tools.tabs.baconian': '培根密码',
  'tools.tabs.caesar': '凯撒密码',
  'tools.tabs.atbash': '埃特巴什码',
  'tools.tabs.vigenere': '维吉尼亚密码',
  'tools.tabs.keyword': '关键字密码',
  'tools.tabs.simple': '简单换位',
  'tools.tabs.adfgvx': 'ADFGVX密码',
  'tools.tabs.encoding': '编码转换',
  'tools.tabs.sha256': 'SHA-256',

  'tools.hints.ascii': 'ASCII：字符与数字编码互相转换（支持 Unicode）。',
  'tools.hints.a1z26': 'A1Z26：字母与数字互转（A=1 … Z=26）。',
  'tools.hints.radix': '进制转换：2-36 进制互转（加密=源进制→目标进制，解密=反向）。',
  'tools.hints.base': 'BASE：支持 BASE64 / BASE58 / BASE62 / BASE85 / BASE91 互转。',
  'tools.hints.morse': '摩斯电码：字母/数字/常用符号与摩斯码互相转换，单词间用 / 分隔。',
  'tools.hints.baconian': '培根密码：字母转 5 位 A/B 编码（也接受 0/1）。',
  'tools.hints.caesar': '凯撒密码：把字母按位移量循环平移（0-25）。',
  'tools.hints.atbash': '埃特巴什码：字母表反转（A↔Z）。',
  'tools.hints.vigenere': '维吉尼亚密码：字母或数字密钥逐字符位移，纯数字密钥即为 Gronsfeld 密码。',
  'tools.hints.keyword': '关键字密码：关键字生成替换字母表。',
  'tools.hints.simple': '简单换位：输入 26 个不重复字母作为替换字母表。',
  'tools.hints.adfgvx': 'ADFGVX 密码：密钥生成 6×6 方阵，KeySquare 做列置换，解密自动去除填充。',
  'tools.hints.encoding': '编码转换：按源编码取字节、再按目标编码显示（常用于乱码修复）。',
  'tools.hints.sha256': 'SHA-256：对输入文本计算 SHA-256 哈希（十六进制），不可逆。',

  'tools.keys.sourceRadix': '源进制：',
  'tools.keys.targetRadix': '目标进制：',
  'tools.keys.baseCodec': '编码：',
  'tools.keys.caesarShift': '位移：',
  'tools.keys.secretKey': '密钥：',
  'tools.keys.adfgvxSquare': 'KeySquare：',
  'tools.keys.substitutionAlphabet': '替换字母表：',
  'tools.keys.sourceEncoding': '源编码：',
  'tools.keys.targetEncoding': '目标编码：',

  'tools.actions.encode': '加密',
  'tools.actions.decode': '解密',
  'tools.actions.compute': '计算',
  'tools.actions.copy': '复制结果',
  'tools.actions.clear': '清空',

  'tools.labels.input': '输入：',
  'tools.labels.output': '输出：',

  'tools.errors.ciphers.integer': '必须是整数',
  'tools.errors.ciphers.vigenere.key': '密钥必须包含字母或数字',
  'tools.errors.ciphers.a1z26.numbers': '没有可解析的数字',
  'tools.errors.ciphers.a1z26.invalid': '无法解析的数字：{value}',
  'tools.errors.ciphers.a1z26.range': '数字必须在 1-26 之间：{value}',
  'tools.errors.ciphers.keyword.key': '请输入密钥',
  'tools.errors.ciphers.simple.alphabet': '替换字母表必须恰好包含 26 个不重复字母',
  'tools.errors.ciphers.baconian.none': '没有可解析的培根码',
  'tools.errors.ciphers.baconian.length': '培根码长度必须是 5 的倍数',
  'tools.errors.ciphers.baconian.invalid': '无效的培根码：{group}',
  'tools.errors.ciphers.ascii.numbers': '没有可解析的数字',
  'tools.errors.ciphers.ascii.invalid': '无法解析的数字：{value}',
  'tools.errors.ciphers.ascii.range': '超出 Unicode 范围：{value}',
  'tools.errors.ciphers.radix.number': '请输入数字',
  'tools.errors.ciphers.radix.parse': '无法按 {radix} 进制解析输入',
  'tools.errors.ciphers.radix.range': '进制必须在 2-36 之间',
  'tools.errors.ciphers.adfgvx.key': '请输入密钥',
  'tools.errors.ciphers.adfgvx.square': '请输入转置密钥',
  'tools.errors.ciphers.adfgvx.noPlain': '输入中没有任何可加密的字母或数字',
  'tools.errors.ciphers.adfgvx.length': '密文长度不是 KeySquare 长度的整数倍（请检查 KeySquare）',
  'tools.errors.base.unsupported': '不支持的编码：{name}',
  'tools.errors.base.invalidChar': '无效的编码字符：{char}',
  'tools.errors.base.decodeFailed': '解码失败，请检查输入内容和编码类型',
  'tools.errors.base64.invalidLength': '无效的 Base64 字符串：数据字符数不能为 4 的倍数余 1',
  'tools.errors.base85.overflow': 'Ascii85 溢出',
  'tools.errors.base85.zInside': 'z 不能出现在 Ascii85 5 元组内部',
  'tools.errors.base85.invalidChar': '发现非 Ascii85 字符：{char}',
  'tools.errors.encodings.unsupported': '不支持的编码：{name}',
  'tools.errors.encodings.encodeFailed': '无法按 {encoding} 编码输入（包含该编码不支持的字符）',
  'tools.errors.encodings.decodeFailed': '无法按 {encoding} 解码输入（字节序列无效）',
  'tools.errors.encodings.convertFailed': '转换失败',
  'tools.errors.matrix.ipInvalid': '无效的 IP 地址',
  'tools.errors.matrix.portRange': '端口必须在 0-65535 之间',
  'tools.errors.matrix.rbfClass': 'RBF 类必须在 0-9 之间',
  'tools.errors.matrix.size': '矩阵必须是 7×7',
  'tools.errors.matrix.digits': '矩阵每个格子必须填 0-9 的一位数字',
  'tools.errors.matrix.f6': 'F6 行只能包含 0 和 1',
  'tools.errors.matrix.square': '矩阵必须为非空方阵',
};

/** Substitute `{name}` placeholders; unknown placeholders are left intact. */
export function interpolate(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/** Resolve a catalogue key, falling back to the key itself when it is absent. */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const template = LABELS[key];
  if (template === undefined) return key;
  return interpolate(template, params);
}

/**
 * Resolve a `ToolError.key` (e.g. `ciphers.integer`) to its zh-CN message.
 *
 * The cipher implementations throw bare keys; the host page used to prefix
 * them with `tools.errors.` before looking them up, so that prefix is applied
 * here too.
 */
export function tError(key: string, params: Record<string, string | number> = {}): string {
  return t(`tools.errors.${key}`, params);
}
