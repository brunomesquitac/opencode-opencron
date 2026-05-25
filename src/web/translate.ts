export function t(translations: Record<string, string>, key: string, ...args: (string | number)[]): string {
  let str = translations[key];
  if (str === undefined) return key;
  if (args.length > 0) {
    for (let i = 0; i < args.length; i++) {
      str = str.replace(new RegExp(`\\{${i}\\}`, 'g'), String(args[i]));
    }
  }
  return str;
}

export function formatClientTranslations(translations: Record<string, string>): string {
  const safe: Record<string, string> = {};
  const alertKeys = Object.keys(translations).filter(k => k.startsWith('alert.') || k.startsWith('stars.') || k.startsWith('btn.') || k.startsWith('status.') || k.startsWith('browse.') || k.startsWith('clone.') || k.startsWith('template.edit.') || k.startsWith('newTask.') || k.startsWith('toast.') || k === 'system.saveMessage' || k === 'system.restartHint');
  for (const key of alertKeys) {
    safe[key] = translations[key];
  }
  return JSON.stringify(safe);
}
