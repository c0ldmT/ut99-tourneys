import { inject, Injectable, Pipe, signal, type PipeTransform } from '@angular/core';
import { DICT, translate, type Lang } from './i18n-dict';

const KEY = 'tourney.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'de' || saved === 'en') return saved;
  } catch {
    // storage unavailable
  }
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** Runtime translations (English and German), switchable without reloading. */
@Injectable({ providedIn: 'root' })
export class I18n {
  readonly lang = signal<Lang>(initialLang());
  readonly languages: Lang[] = Object.keys(DICT) as Lang[];

  constructor() {
    document.documentElement.lang = this.lang();
  }

  set(lang: Lang): void {
    this.lang.set(lang);
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      // storage unavailable
    }
  }

  t(key: string, params?: Record<string, string | number>): string {
    return translate(this.lang(), key, params);
  }

  date(iso: string | null | undefined): string {
    if (!iso) return '';
    return new Date(iso).toLocaleString(this.lang() === 'de' ? 'de-DE' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }
}

/** {{ 'key' | t }} or {{ 'key' | t: { n: 3 } }}; re-evaluated when the language changes. */
@Pipe({ name: 't', pure: false })
export class TPipe implements PipeTransform {
  private readonly i18n = inject(I18n);
  transform(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }
}
