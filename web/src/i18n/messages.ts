import type { SupportedLocale } from './locales'

const zhCN = {
  app: {
    brand: 'GCAC 控制台',
    platform: '企业 SSL 证书生命周期管理平台',
    defaultBreadcrumb: '控制台',
    dashboard: '仪表盘'
  },
  common: {
    refresh: '刷新',
    logout: '退出',
    enter: '进入',
    loading: '加载中',
    userFallback: '未登录用户',
    tenantFallback: '默认租户'
  },
  preferences: {
    theme: '主题',
    language: '语言',
    themeLight: '日间模式',
    themeDark: '夜间模式',
    themeToggle: '切换主题模式',
    languageSelect: '选择界面语言',
    title: '显示偏好',
    description: '主题和语言会保存到当前用户的后端偏好。'
  },
  userMenu: {
    currentUser: '当前用户',
    changePassword: '修改密码',
    logout: '退出登录'
  },
  password: {
    title: '修改密码',
    description: '修改当前登录用户的本地密码。',
    current: '当前密码',
    new: '新密码',
    confirm: '确认新密码',
    cancel: '取消',
    submit: '保存密码',
    submitting: '正在保存…',
    success: '密码已更新',
    failed: '密码修改失败',
    mismatch: '两次输入的新密码不一致',
    tooShort: '新密码长度不能少于 8 位'
  },
  nav: {
    dashboard: '总览',
    dashboardDesc: '应用、证书、Agent、网关和审计状态总览',
    certificates: '证书',
    certificatesDesc: '证书库、绑定关系和到期状态',
    certificateAssets: '证书资产',
    certificateAssetsDesc: '证书、私钥引用、指纹和到期时间',
    certificateFormats: '证书格式配置',
    certificateFormatsDesc: '为已保存证书定义 PFX、CER、CRT、PEM 等格式规则',
    assets: '应用资产',
    assetsDesc: '域名/IP 维度的应用入口与证书部署目标',
    agents: 'Agent',
    agentsDesc: '在线状态、心跳和能力集合',
    gateways: '网关',
    gatewaysDesc: '隔离区网关、协议和可达目标',
    deployments: '证书部署',
    deploymentsDesc: '部署计划和执行记录',
    deploymentPlans: '部署计划',
    deploymentPlansDesc: '证书部署计划和审批入口',
    executions: '执行记录',
    executionsDesc: '执行步骤、日志、失败和回滚',
    workflows: '工作流',
    workflowsDesc: '工作流和插件',
    workflowTemplates: '工作流',
    workflowTemplatesDesc: '画布草稿、变量、能力声明和发布',
    plugins: '插件',
    pluginsDesc: 'Provider、执行器和沙箱状态',
    monitoring: '监控',
    monitoringDesc: '告警、审计和证书状态',
    monitorAlerts: '监控告警',
    monitorAlertsDesc: '到期、漂移和执行失败事件',
    audits: '审计日志',
    auditsDesc: '操作证据与合规导出',
    settings: '设置',
    settingsDesc: '租户、用户、权限和系统配置',
    systemSettings: '系统设置',
    systemSettingsDesc: '系统配置和安全元数据',
    users: '用户管理',
    usersDesc: '控制台用户、状态和角色',
    roles: '权限管理',
    rolesDesc: '角色、授权对象范围和成员分配',
    identitySources: '身份源',
    identitySourcesDesc: 'AD/LDAP 服务配置'
  },
  login: {
    visualLabel: '产品说明',
    brand: 'GCAC 智能证书平台',
    headlinePrefix: '让证书管理',
    headlineHighlight: '更智能',
    headlineSuffix: '、更安全',
    intro: '一站式管理证书资产，自动化部署编排，全链路审计追踪，将证书运维从繁琐的人工操作转变为可验证、可回溯的标准化流程，为企业数字基础设施保驾护航。',
    capabilitiesLabel: '平台能力',
    featureLifecycle: '全生命周期管理',
    featureLifecycleDesc: '从导入、续签、版本追踪到到期预警，覆盖证书资产的每一个环节。',
    featureAutomation: '自动化部署编排',
    featureAutomationDesc: '面向 Nginx、Tomcat、IIS 等主流环境，一键生成可审计的部署计划。',
    featureRollback: '安全执行与回滚',
    featureRollbackDesc: '部署前自动校验，执行全程留痕，失败即回滚，确保生产环境稳定无忧。',
    formLabel: '登录表单',
    secure: '安全连接',
    welcome: '欢迎回来',
    hint: '请输入您的账号信息，进入管理控制台',
    username: '用户名',
    usernamePlaceholder: '请输入用户名',
    password: '密码',
    passwordPlaceholder: '请输入密码',
    failed: '登录失败，请稍后重试',
    submitting: '正在验证身份…',
    submit: '登 录',
    policy: '受企业级权限策略保护',
    audit: '全链路操作审计'
  },
  errors: {
    forbiddenTitle: '403 无权限',
    forbiddenMessage: '你没有访问该页面所需的权限。',
    missingPermission: '缺失权限：{permission}',
    notFoundTitle: '404 页面不存在',
    notFoundMessage: '这个路由没有注册。别在页面里硬跳未定义路径。',
    backDashboard: '返回仪表盘'
  },
  settings: {
    securityLabel: '安全设置入口'
  }
}

const zhTW = {
  ...zhCN,
  app: { ...zhCN.app, brand: 'GCAC 控制台', platform: '企業 SSL 憑證生命週期管理平台', defaultBreadcrumb: '控制台', dashboard: '儀表板' },
  common: { ...zhCN.common, refresh: '重新整理', logout: '登出', enter: '進入', userFallback: '未登入使用者', tenantFallback: '預設租戶' },
  preferences: { ...zhCN.preferences, theme: '主題', language: '語言', themeLight: '日間模式', themeDark: '夜間模式', title: '顯示偏好', description: '主題和語言會儲存到目前使用者的後端偏好。' },
  userMenu: { ...zhCN.userMenu, currentUser: '目前使用者', changePassword: '修改密碼', logout: '登出' },
  password: { ...zhCN.password, title: '修改密碼', description: '修改目前登入使用者的本機密碼。', current: '目前密碼', new: '新密碼', confirm: '確認新密碼', submit: '儲存密碼', success: '密碼已更新', failed: '密碼修改失敗', mismatch: '兩次輸入的新密碼不一致' },
  errors: { ...zhCN.errors, forbiddenTitle: '403 無權限', forbiddenMessage: '你沒有存取該頁面所需的權限。', missingPermission: '缺少權限：{permission}', notFoundTitle: '404 頁面不存在', notFoundMessage: '這個路由尚未註冊。不要在頁面裡硬跳未定義路徑。', backDashboard: '返回儀表板' }
}

const enUS = {
  ...zhCN,
  app: { brand: 'GCAC Console', platform: 'Enterprise SSL Certificate Lifecycle Platform', defaultBreadcrumb: 'Console', dashboard: 'Dashboard' },
  common: { refresh: 'Refresh', logout: 'Sign out', enter: 'Open', loading: 'Loading', userFallback: 'Guest user', tenantFallback: 'Default tenant' },
  preferences: { theme: 'Theme', language: 'Language', themeLight: 'Light', themeDark: 'Dark', themeToggle: 'Switch theme', languageSelect: 'Select language', title: 'Display preferences', description: 'Theme and language are saved to your backend user preferences.' },
  userMenu: { currentUser: 'Current user', changePassword: 'Change password', logout: 'Sign out' },
  password: { title: 'Change password', description: 'Change the local password for the signed-in user.', current: 'Current password', new: 'New password', confirm: 'Confirm new password', cancel: 'Cancel', submit: 'Save password', submitting: 'Saving…', success: 'Password updated', failed: 'Password change failed', mismatch: 'The new passwords do not match', tooShort: 'The new password must be at least 8 characters' },
  errors: { forbiddenTitle: '403 Forbidden', forbiddenMessage: 'You do not have permission to access this page.', missingPermission: 'Missing permission: {permission}', notFoundTitle: '404 Not Found', notFoundMessage: 'This route is not registered.', backDashboard: 'Back to dashboard' }
}

const jaJP = {
  ...zhCN,
  app: { brand: 'GCAC コンソール', platform: '企業向け SSL 証明書ライフサイクル管理平台', defaultBreadcrumb: 'コンソール', dashboard: 'ダッシュボード' },
  common: { ...enUS.common, refresh: '更新', logout: 'ログアウト', enter: '開く' },
  preferences: { ...enUS.preferences, theme: 'テーマ', language: '言語', themeLight: 'ライト', themeDark: 'ダーク', title: '表示設定' },
  userMenu: { ...enUS.userMenu, currentUser: '現在のユーザー', changePassword: 'パスワード変更', logout: 'ログアウト' },
  password: { ...enUS.password, title: 'パスワード変更', current: '現在のパスワード', new: '新しいパスワード', confirm: '新しいパスワードの確認', cancel: 'キャンセル', submit: '保存' },
  errors: { ...enUS.errors, forbiddenTitle: '403 権限がありません', notFoundTitle: '404 ページがありません', backDashboard: 'ダッシュボードへ戻る' }
}

const frFR = {
  ...zhCN,
  app: { brand: 'Console GCAC', platform: 'Plateforme de cycle de vie des certificats SSL', defaultBreadcrumb: 'Console', dashboard: 'Tableau de bord' },
  common: { ...enUS.common, refresh: 'Actualiser', logout: 'Déconnexion', enter: 'Ouvrir' },
  preferences: { ...enUS.preferences, theme: 'Thème', language: 'Langue', themeLight: 'Clair', themeDark: 'Sombre', title: 'Préférences d’affichage' },
  userMenu: { ...enUS.userMenu, currentUser: 'Utilisateur courant', changePassword: 'Modifier le mot de passe', logout: 'Déconnexion' },
  password: { ...enUS.password, title: 'Modifier le mot de passe', current: 'Mot de passe actuel', new: 'Nouveau mot de passe', confirm: 'Confirmer le mot de passe', cancel: 'Annuler', submit: 'Enregistrer' },
  errors: { ...enUS.errors, forbiddenTitle: '403 Accès refusé', notFoundTitle: '404 Page introuvable', backDashboard: 'Retour au tableau de bord' }
}

const ruRU = {
  ...zhCN,
  app: { brand: 'Консоль GCAC', platform: 'Платформа управления жизненным циклом SSL-сертификатов', defaultBreadcrumb: 'Консоль', dashboard: 'Панель' },
  common: { ...enUS.common, refresh: 'Обновить', logout: 'Выйти', enter: 'Открыть' },
  preferences: { ...enUS.preferences, theme: 'Тема', language: 'Язык', themeLight: 'Светлая', themeDark: 'Темная', title: 'Настройки отображения' },
  userMenu: { ...enUS.userMenu, currentUser: 'Текущий пользователь', changePassword: 'Сменить пароль', logout: 'Выйти' },
  password: { ...enUS.password, title: 'Сменить пароль', current: 'Текущий пароль', new: 'Новый пароль', confirm: 'Подтвердите пароль', cancel: 'Отмена', submit: 'Сохранить' },
  errors: { ...enUS.errors, forbiddenTitle: '403 Нет доступа', notFoundTitle: '404 Страница не найдена', backDashboard: 'Вернуться на панель' }
}

const ptBR = {
  ...zhCN,
  app: { brand: 'Console GCAC', platform: 'Plataforma de ciclo de vida de certificados SSL corporativos', defaultBreadcrumb: 'Console', dashboard: 'Painel' },
  common: { ...enUS.common, refresh: 'Atualizar', logout: 'Sair', enter: 'Abrir' },
  preferences: { ...enUS.preferences, theme: 'Tema', language: 'Idioma', themeLight: 'Claro', themeDark: 'Escuro', title: 'Preferências de exibição' },
  userMenu: { currentUser: 'Usuário atual', changePassword: 'Alterar senha', logout: 'Sair' },
  password: { title: 'Alterar senha', description: 'Altere a senha local do usuário conectado.', current: 'Senha atual', new: 'Nova senha', confirm: 'Confirmar nova senha', cancel: 'Cancelar', submit: 'Salvar senha', submitting: 'Salvando…', success: 'Senha atualizada', failed: 'Falha ao alterar a senha', mismatch: 'As novas senhas não coincidem', tooShort: 'A nova senha deve ter pelo menos 8 caracteres' },
  errors: { ...enUS.errors, forbiddenTitle: '403 Sem permissão', notFoundTitle: '404 Página não encontrada', backDashboard: 'Voltar ao painel' }
}

const koKR = {
  ...zhCN,
  app: { brand: 'GCAC 콘솔', platform: '엔터프라이즈 SSL 인증서 수명 주기 관리 플랫폼', defaultBreadcrumb: '콘솔', dashboard: '대시보드' },
  common: { ...enUS.common, refresh: '새로고침', logout: '로그아웃', enter: '열기' },
  preferences: { ...enUS.preferences, theme: '테마', language: '언어', themeLight: '라이트', themeDark: '다크', title: '표시 설정' },
  userMenu: { ...enUS.userMenu, currentUser: '현재 사용자', changePassword: '비밀번호 변경', logout: '로그아웃' },
  password: { ...enUS.password, title: '비밀번호 변경', current: '현재 비밀번호', new: '새 비밀번호', confirm: '새 비밀번호 확인', cancel: '취소', submit: '저장' },
  errors: { ...enUS.errors, forbiddenTitle: '403 권한 없음', notFoundTitle: '404 페이지 없음', backDashboard: '대시보드로 돌아가기' }
}

export const messages: Record<SupportedLocale, typeof zhCN> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
  'fr-FR': frFR,
  'ru-RU': ruRU,
  'pt-BR': ptBR,
  'ko-KR': koKR
}
