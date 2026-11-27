import type { Api } from './api';
import type { Auth } from './auth';
import type { I18n } from './i18n';

/**
 * Ending a season (decision 333): the sentence about the library nominations that wait, so an
 * admin knows they stay and where to approve them; empty without any (or for non-admins).
 */
export async function nominationNote(api: Api, auth: Auth, i18n: I18n): Promise<string> {
  if (!auth.me()?.isAdmin || !auth.config().udt) return '';
  try {
    const n = (await api.udtNominations()).length;
    return n ? ' ' + i18n.t('season.endNominations', { n }) : '';
  } catch {
    return '';
  }
}
