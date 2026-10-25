/**
 * Shared pieces of the settings tabs (admin/settings): the form look and the event a tab sends
 * when one of its forms is saved, so the page can drop that form's "unsaved" mark.
 */

/** Styles every settings tab uses (cards, rows of fields, narrow inputs). */
export const SETTINGS_STYLES = `
  .card {
    max-width: 820px;
  }
  .row.gap {
    gap: 16px;
    align-items: flex-end;
  }
  h3 {
    margin: 20px 0 8px;
    font-size: 1rem;
  }
  input.narrow {
    width: 120px;
    display: block;
    margin-top: 4px;
  }
  input[type='date'] {
    display: block;
    margin-top: 4px;
  }
`;

/**
 * The key of a settings form: forms carry it as `data-form`; a tab emits it after saving. The
 * page marks a tab as unsaved while one of its keyed forms has changes.
 */
export type SettingsForm = 'rating' | 'season' | 'betting' | 'shop' | 'botAi' | 'live' | 'udt';
