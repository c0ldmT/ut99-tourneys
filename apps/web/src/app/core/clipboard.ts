/**
 * Copies text to the clipboard. The Clipboard API only exists on secure pages (https:// or
 * localhost); a website opened by its LAN address (http://192.168.x.y:8080) does not have it,
 * so the text goes through a hidden text field and the browser's copy command instead.
 * Returns false if neither worked (the caller then asks the user to copy by hand).
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the copy command
    }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** Selects the text of an element, so the user can copy it with Ctrl+C. */
export function selectText(el: Element | null): void {
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
