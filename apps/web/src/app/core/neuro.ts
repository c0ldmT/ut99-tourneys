import { inject, Pipe, type PipeTransform } from '@angular/core';
import { I18n } from './i18n';

/**
 * Neuro, the website's virtual currency (symbol €). Amounts are whole Neuro, written with the
 * language's digit grouping and the symbol after the number: "1.250 €" / "1,250 €".
 */
export function formatNeuro(n: number, lang: string): string {
  const locale = lang === 'de' ? 'de-DE' : 'en-GB';
  return `${Math.round(n).toLocaleString(locale)}\u00a0€`;
}

/** {{ amount | neuro }}; re-evaluated when the language changes. */
@Pipe({ name: 'neuro', pure: false })
export class NeuroPipe implements PipeTransform {
  private readonly i18n = inject(I18n);
  transform(n: number | null | undefined): string {
    return n === null || n === undefined ? '' : formatNeuro(n, this.i18n.lang());
  }
}
