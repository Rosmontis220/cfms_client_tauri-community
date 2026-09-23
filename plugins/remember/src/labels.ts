/**
 * Strings for the 记住用户名密码 plugin.
 *
 * A community plugin runs inside a shadow root and cannot reach the host's i18n
 * runtime, so the strings ship with the plugin. Two locales are carried because
 * this plugin renders inside the sign-in form, which every user sees on every
 * start: a Chinese checkbox under an English form would be the first thing an
 * English-locale user noticed.
 */

type Labels = {
  title: string;
  rememberMe: string;
  rememberPassword: string;
  savedAccounts: string;
  savedPassword: string;
  useAccount: string;
  removeAccount: string;
  failed: string;
};

const ZH_CN: Labels = {
  title: '记住用户名密码',
  rememberMe: '记住我',
  rememberPassword: '记住密码',
  savedAccounts: '已保存的账户',
  savedPassword: '已保存密码',
  useAccount: '使用账户 {username}',
  removeAccount: '移除已保存的账户 {username}',
  failed: '记住用户名密码插件无法工作：{reason}',
};

const EN: Labels = {
  title: 'Remember username and password',
  rememberMe: 'Remember me',
  rememberPassword: 'Remember password',
  savedAccounts: 'Saved accounts',
  savedPassword: 'Password saved',
  useAccount: 'Use account {username}',
  removeAccount: 'Remove saved account {username}',
  failed: 'The remember-me plugin cannot run: {reason}',
};

/**
 * Pick a catalogue from the platform language.
 *
 * The host renders its own UI in the user's chosen locale, which a shadow root
 * cannot read, so the platform language is the closest thing available. It
 * agrees with the host's choice in every default configuration, and disagreeing
 * costs a translated string rather than a broken screen.
 */
function activeLabels(): Labels {
  const language =
    typeof navigator !== 'undefined' && typeof navigator.language === 'string'
      ? navigator.language.toLowerCase()
      : '';
  return language.startsWith('zh') ? ZH_CN : EN;
}

const LABELS = activeLabels();

/** Look up a label, filling `{name}` placeholders. */
export function t(key: keyof Labels, values: Record<string, string> = {}): string {
  return LABELS[key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}
