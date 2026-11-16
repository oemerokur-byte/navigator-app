import { getLangNameFromCode } from 'language-name-map';
import { getString } from '../utils/storage';
import { get, navigatorConfig } from '../utils';
import en from '../../translations/en.json';
import de from '../../translations/de.json';
import uk from '../../translations/uk.json';
import ru from '../../translations/ru.json';
import bg from '../../translations/bg.json';
import ro from '../../translations/ro.json';
import sq from '../../translations/sq.json';
import hr from '../../translations/hr.json';
import sr from '../../translations/sr.json';
import es from '../../translations/es.json';
import tr from '../../translations/tr.json';
import ar from '../../translations/ar.json';
import I18n from 'react-native-i18n';

export const translations = {
    de,
    en,
    uk,
    ru,
    bg,
    ro,
    sq,
    hr,
    sr,
    es,
    tr,
    ar,
};

export function getAvailableLocales() {
    const availableLocales = navigatorConfig('availableLocales', Object.keys(translations));
    return Object.fromEntries(Object.entries(translations).filter(([locale]) => availableLocales.includes(locale)));
}

export function getLocale() {
    return getString('_locale') ?? navigatorConfig('defaultLocale', 'en');
}

export function getLanguage() {
    const locale = getLocale();
    return { code: locale, ...getLangNameFromCode(locale) };
}

export function translate(key, options) {
    return I18n.t(key, options);
}
