import { config } from '@vue/test-utils'
import { i18n } from '../src/i18n'

config.global.stubs = {
  RouterLink: true
}

config.global.plugins = [i18n]

// 单元测试断言使用中文基准文案；生产环境仍由浏览器语言决定初始界面语言。
i18n.global.locale.value = 'zh-CN'
