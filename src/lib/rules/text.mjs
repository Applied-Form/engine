/** Type: voices, sizes, contrast, wordmark, register-specific voice rules. */
import { colors, floors, typeScale, display, fallbacks, colorName, voices, familyOf, prohibitions } from '../tokens.mjs';
import { contrast, requiredContrast, safeVariant, apca } from '../contrast.mjs';
import { eq } from './util.mjs';

export function checkText(ctx, spec, add) {
  const { palette, isII } = ctx;
  for (const t of spec.text ?? []) {
    const bg = t.background ?? spec.background ?? palette.background;
    // The voices are whatever the system's font group declares, however many that is.
    if (t.voice && !voices.includes(t.voice)) {
      add('font-off-system', `${t.family ?? t.voice} is not one of this system's ${voices.length} voices (${voices.map(familyOf).join(', ')})`, { text: t });
    }
    if (t.isWordmark) {
      add('wordmark-live-text', 'Never live-text the wordmark; use the outlined SVG', { text: t });
      continue;
    }
    if (t.voice === 'display' && isII) {
      add('display-voice-in-ii', `The display voice (${familyOf('display')}) is not permitted in Register II beyond the wordmark`, { text: t });
    }
    if (isII && t.role === 'heading' && (t.voice !== 'text' || (t.weight ?? 400) < typeScale['heading-02'].weight)) {
      add('heading-voice-ii', `Register II headings are ${familyOf('text')} ${typeScale['heading-02'].weight}`, { text: t });
    }
    if (isII && t.color && eq(t.color, palette.accent) && !t.isInteractive && !t.isData) {
      add('accent-non-interactive-ii', `In Register II the accent (${colorName(palette.accent) ?? palette.accent}) appears only on interactive elements`, { text: t });
    }
    if (t.isData && t.voice !== 'data') {
      add('data-not-mono', `Every numeral, unit, label, ID, and status is set in the data voice (${familyOf('data')})`, { text: t });
    }
    if (t.color && bg && !t.isDisabled && t.sizePx != null && t.sizePx <= floors.textMinPx + 0.5 && Math.abs(apca(t.color, bg)) < floors.labelApca) {
      add('label-apca', `Label-size text must clear APCA Lc ${floors.labelApca}; got ${Math.abs(apca(t.color, bg)).toFixed(0)}`, { text: t, lc: Math.abs(apca(t.color, bg)) });
    }
    if (t.sizePx != null && t.sizePx < floors.textMinPx) {
      add('text-too-small', `Nothing is set below ${floors.textMinPx}px; got ${t.sizePx}px`, { text: t });
    }
    if (isII && t.voice === 'text' && !t.isData && t.role !== 'heading' && t.sizePx != null && t.sizePx < floors.bodyMinPxRegisterII) {
      add('body-too-small', `Register II text is ${floors.bodyMinPxRegisterII}px minimum, got ${t.sizePx}px`, { text: t });
    }
    if (!t.isData && t.measureCh != null && t.measureCh > floors.maxMeasureCh) {
      add('measure', `Measure must be ≤${floors.maxMeasureCh}ch, got ${t.measureCh}ch`, { text: t });
    }
    // WCAG 1.4.3 exempts text that is part of an inactive user interface component, and this
    // system dims one with an opacity token, so an unavailable button would otherwise fail a floor
    // for being unavailable. Found by putting every component state on one page and linting it.
    if (t.color && bg && !t.isDisabled) {
      const ratio = contrast(t.color, bg);
      const need = requiredContrast(t.sizePx ?? 16, t.weight ?? 400, floors);
      if (ratio < need) {
        const suggestion = safeVariant(t.color, bg, t.sizePx ?? 16, t.weight ?? 400, { fallbacks, colorName, floors });
        const hint = suggestion ? ` Use ${colorName(suggestion)} ${suggestion} instead.` : ' Change the ground.';
        add('contrast', `Contrast ${ratio.toFixed(2)}:1 is below the ${need}:1 floor for ${t.sizePx}px text.${hint}`, { text: t, ratio, need, suggestion });
      }
    }
    // Pairings the system refuses outright, which is how it states something stricter than
    // the contrast floor. Applied Form declares one; another system declares its own, or none.
    for (const pair of prohibitions.pairs) {
      if (t.color && eq(t.color, pair.text) && bg && eq(bg, pair.ground)) {
        add('forbidden-pairing', `${colorName(pair.text) ?? pair.text} text never sits on ${colorName(pair.ground) ?? pair.ground}`, { text: t });
      }
    }
    if (t.color && eq(t.color, colors.caution) && (t.sizePx ?? 16) < floors.largeTextPx && bg && contrast(t.color, bg) < floors.bodyContrast) {
      add('caution-as-text', 'Caution is a fill colour, never small running text on a light ground', { text: t });
    }
    if (t.voice === 'display' && t.weight != null && !t.isWordmark) {
      if (t.weight < display.weightMin || t.weight > display.weightMax) {
        add('display-weight', `${familyOf('display')} weight must be ${display.weightMin}–${display.weightMax}, got ${t.weight}`, { text: t });
      }
    }
  }
}
