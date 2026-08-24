import { config } from '@vue/test-utils'
import { i18n } from '../src/i18n'

config.global.stubs = {
  RouterLink: true
}

config.global.plugins = [i18n]
