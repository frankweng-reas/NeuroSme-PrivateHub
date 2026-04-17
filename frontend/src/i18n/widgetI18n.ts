/** Widget 專用 i18n（不影響主 app） */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import zhTW from './widget/zh-TW.json'
import zhCN from './widget/zh-CN.json'
import en from './widget/en.json'
import ja from './widget/ja.json'

const widgetI18n = i18n.createInstance()

widgetI18n.use(initReactI18next).init({
  resources: {
    'zh-TW': { widget: zhTW },
    'zh-CN': { widget: zhCN },
    en: { widget: en },
    ja: { widget: ja },
  },
  lng: 'zh-TW',
  fallbackLng: 'zh-TW',
  defaultNS: 'widget',
  interpolation: { escapeValue: false },
})

export default widgetI18n
