import type { SupportedLocale } from './locales'

export const licensingLocaleMessages = {
  'zh-CN': {
    licensing: {
      title: '产品授权',
      description: '查看当前安装实例的授权状态，并完成在线或离线授权文件操作。',
      summary: { title: '授权状态', unconfigured: '未配置许可证' },
      fields: { installationId: '安装实例 ID', expiresAt: '到期时间', graceEndsAt: '宽限期结束', lastClockAt: '最近时间检查' },
      states: { unlicensed: '未授权', active: '有效', grace: '宽限期', expired: '已过期', revoked: '已撤销', clock_rollback_detected: '检测到时间回退' },
      plans: { free: '免费版', commercial: '商业版', enterprise: '企业版', trial: '免费版', standard: '商业版', professional: '商业版' },
      features: { title: '已授权功能', empty: '当前没有可用功能。' },
      quotas: { title: '额度', managedTargets: '应用资产', concurrentExecutions: '并发执行', plugins: '插件数量', unlimited: '不限' },
      actions: {
        title: '授权文件',
        description: '在线请求适用于联网环境，离线请求可导出后交给授权方处理。',
        upgrade: '升级授权',
        onlineRequest: '导出在线请求',
        offlineRequest: '导出离线请求',
        export: '导出当前授权',
        importLabel: '导入许可证 JSON',
        importPlaceholder: '粘贴许可证导出文件内容',
        import: '导入许可证'
      },
      comparison: {
        title: '升级授权',
        subtitle: '查看不同授权版本的功能边界，再决定是否升级。',
        currentPlan: '当前授权：{plan}',
        noActivePlan: '当前尚未导入有效授权，可先查看版本能力差异。',
        badges: { current: '当前版本', recommended: '推荐升级' },
        footer: { consult: '采购咨询', faq: '授权常见问题' },
        cards: {
          free: { summary: '适合评估、自用或轻量场景', price: '免费使用', features: { full: '全功能可用', usage: '仅限非商业用途使用', automation: '包含自动化更新流程', quota: '限制 5 个应用资产', support: '社区 / 邮件支持' } },
          commercial: { summary: '适合标准生产环境和按需扩容', priceCny: '699 元 / 应用资产', priceUsd: 'USD 99 / application asset', features: { full: '全功能可用', usage: '可用于商业场景', automation: '自动化更新流程', quota: '按需购买应用资产，无限期使用', support: '1 年版本升级服务及远程技术支持' } },
          enterprise: { summary: '适合大型环境、私有化和定制合作', price: '联系销售', features: { full: '全功能可用', usage: '可用于商业场景', automation: '自动化更新流程', approval: '包含流程审批引擎', quota: '按需购买应用资产，无限期使用', customization: '针对需求进行定制', support: '专属技术支持' } },
        }
      },
      messages: {
        loadFailed: '授权状态加载失败。',
        operationFailed: '授权操作失败。',
        exported: '授权文件已导出。',
        requestExported: '激活请求文件已导出。',
        invalidJson: '请输入合法的 JSON。',
        licenseMissing: 'JSON 中缺少许可证对象。',
        imported: '许可证已导入。',
        importFailed: '许可证导入失败。'
      }
    }
  },
  'zh-TW': {
    licensing: {
      title: "產品授權",
      description: "查看目前安裝實例的授權狀態，並完成線上或離線授權檔案操作。",
      summary: { title: "授權狀態", unconfigured: "未設定授權" },
      fields: { installationId: "安裝實例 ID", expiresAt: "到期時間", graceEndsAt: "寬限期結束", lastClockAt: "最近時間檢查" },
      states: { unlicensed: "未授權", active: "有效", grace: "寬限期", expired: "已過期", revoked: "已撤銷", clock_rollback_detected: "偵測到時間回退" },
      plans: { free: "免費版", commercial: "商業版", enterprise: "企業版", trial: "免費版", standard: "商業版", professional: "商業版" },
      features: { title: "已授權功能", empty: "目前沒有可用功能。" },
      quotas: { title: "額度", managedTargets: "應用資產", concurrentExecutions: "並行執行", plugins: "外掛數量", unlimited: "不限" },
      actions: { title: "授權檔案", description: "線上請求適用於連網環境，離線請求可匯出後交給授權方處理。", upgrade: "升級授權", onlineRequest: "匯出線上請求", offlineRequest: "匯出離線請求", export: "匯出目前授權", importLabel: "匯入授權 JSON", importPlaceholder: "貼上授權匯出檔案內容", import: "匯入授權" },
      comparison: {
        title: "升級授權",
        subtitle: "查看不同授權版本的功能邊界，再決定是否升級。",
        currentPlan: "目前授權：{plan}",
        noActivePlan: "目前尚未匯入有效授權，可先查看版本能力差異。",
        badges: { current: "目前版本", recommended: "建議升級" },
        footer: { consult: "採購諮詢", faq: "授權常見問題" },
        cards: {
          free: { summary: "適合評估、自用或輕量場景", price: "免費使用", features: { full: "全功能可用", usage: "僅限非商業用途使用", automation: "包含自動化更新流程", quota: "限制 5 個應用資產", support: "社群 / 郵件支援" } },
          commercial: { summary: "適合標準生產環境和按需擴容", priceCny: "699 元 / 應用資產", priceUsd: "USD 99 / application asset", features: { full: "全功能可用", usage: "可用於商業場景", automation: "自動化更新流程", quota: "依需求購買應用資產，無限期使用", support: "1 年版本升級服務及遠端技術支援" } },
          enterprise: { summary: "適合大型環境、私有化和定製合作", price: "聯絡銷售", features: { full: "全功能可用", usage: "可用於商業場景", automation: "自動化更新流程", approval: "包含流程審批引擎", quota: "依需求購買應用資產，無限期使用", customization: "針對需求進行定製", support: "專屬技術支援" } },
        }
      },
      messages: { loadFailed: "授權狀態載入失敗。", operationFailed: "授權操作失敗。", exported: "授權檔案已匯出。", requestExported: "啟用請求檔案已匯出。", invalidJson: "請輸入合法的 JSON。", licenseMissing: "JSON 中缺少授權物件。", imported: "授權已匯入。", importFailed: "授權匯入失敗。" }
    }
  },
  'en-US': {
    licensing: {
      title: 'Product licensing',
      description: 'View this installation license and complete online or offline license file operations.',
      summary: { title: 'License status', unconfigured: 'License not configured' },
      fields: { installationId: 'Installation ID', expiresAt: 'Expires at', graceEndsAt: 'Grace period ends', lastClockAt: 'Last clock check' },
      states: { unlicensed: 'Unlicensed', active: 'Active', grace: 'Grace period', expired: 'Expired', revoked: 'Revoked', clock_rollback_detected: 'Clock rollback detected' },
      plans: { free: 'Free', commercial: 'Commercial', enterprise: 'Enterprise', trial: 'Free', standard: 'Commercial', professional: 'Commercial' },
      features: { title: 'Licensed features', empty: 'No licensed features are available.' },
      quotas: { title: 'Quotas', managedTargets: 'Application assets', concurrentExecutions: 'Concurrent executions', plugins: 'Plugins', unlimited: 'Unlimited' },
      actions: { title: 'License files', description: 'Use an online request for connected environments or export an offline request for the licensing operator.', upgrade: 'Upgrade license', onlineRequest: 'Export online request', offlineRequest: 'Export offline request', export: 'Export current license', importLabel: 'Import license JSON', importPlaceholder: 'Paste the license export file content', import: 'Import license' },
      comparison: {
        title: 'Upgrade license',
        subtitle: 'Compare license tiers before deciding whether to upgrade.',
        currentPlan: 'Current license: {plan}',
        noActivePlan: 'No active license is installed yet. Review the tier differences first.',
        badges: { current: 'Current tier', recommended: 'Recommended upgrade' },
        footer: { consult: 'Purchase consultation', faq: 'License FAQ' },
        cards: {
          free: { summary: 'Best for evaluation, personal use, and light workloads', price: 'Free to use', features: { full: 'All features enabled', usage: 'For non-commercial use only', automation: 'Includes automated update workflows', quota: 'Limited to 5 application assets', support: 'Community and email support' } },
          commercial: { summary: 'Best for standard production environments and flexible growth', priceCny: 'CNY 699 / application asset', priceUsd: 'USD 99 / application asset', features: { full: 'All features enabled', usage: 'Available for commercial use', automation: 'Automated update workflows', quota: 'Buy application assets as needed with unlimited use', support: '1 year of version upgrades and remote technical support' } },
          enterprise: { summary: 'Best for large-scale environments, private deployment, and custom collaboration', price: 'Contact sales', features: { full: 'All features enabled', usage: 'Available for commercial use', automation: 'Automated update workflows', approval: 'Includes workflow approval engine', quota: 'Buy application assets as needed with unlimited use', customization: 'Customization tailored to your requirements', support: 'Dedicated technical support' } },
        }
      },
      messages: { loadFailed: 'Failed to load license status.', operationFailed: 'License operation failed.', exported: 'License file exported.', requestExported: 'Activation request exported.', invalidJson: 'Enter valid JSON.', licenseMissing: 'The JSON does not contain a license object.', imported: 'License imported.', importFailed: 'Failed to import license.' }
    }
  },
  'ja-JP': {
    licensing: {
      title: '製品ライセンス',
      description: 'このインストールのライセンス状態を確認し、オンラインまたはオフラインのライセンスファイルを操作します。',
      summary: { title: 'ライセンス状態', unconfigured: 'ライセンス未設定' },
      fields: { installationId: 'インストール ID', expiresAt: '有効期限', graceEndsAt: '猶予期間終了', lastClockAt: '最終時刻確認' },
      states: { unlicensed: '未認証', active: '有効', grace: '猶予期間', expired: '期限切れ', revoked: '失効', clock_rollback_detected: '時刻の巻き戻しを検出' },
      plans: { free: '無料版', commercial: '商用版', enterprise: 'エンタープライズ版', trial: '無料版', standard: '商用版', professional: '商用版' },
      features: { title: '許可された機能', empty: '利用可能な機能はありません。' },
      quotas: { title: '上限', managedTargets: 'アプリケーション資産', concurrentExecutions: '同時実行', plugins: 'プラグイン', unlimited: '無制限' },
      actions: { title: 'ライセンスファイル', description: '接続環境ではオンライン要求、分離環境ではオフライン要求を使用します。', upgrade: 'ライセンスをアップグレード', onlineRequest: 'オンライン要求を出力', offlineRequest: 'オフライン要求を出力', export: '現在のライセンスを出力', importLabel: 'ライセンス JSON を入力', importPlaceholder: 'ライセンスファイルの内容を貼り付け', import: 'ライセンスを取り込む' },
      comparison: {
        title: 'ライセンスをアップグレード',
        subtitle: '各ライセンスの違いを確認してからアップグレードを判断します。',
        currentPlan: '現在のライセンス：{plan}',
        noActivePlan: '有効なライセンスはまだ導入されていません。まずは各プランの違いを確認してください。',
        badges: { current: '現在のプラン', recommended: 'おすすめアップグレード' },
        footer: { consult: '購入相談', faq: 'ライセンス FAQ' },
        cards: {
          free: { summary: '評価、個人利用、軽量な用途向け', price: '無料で利用可能', features: { full: '全機能を利用可能', usage: '非商用利用に限定', automation: '自動更新ワークフローを含む', quota: 'アプリケーション資産は 5 件まで', support: 'コミュニティ / メールサポート' } },
          commercial: { summary: '標準的な本番運用と段階的な拡張向け', priceCny: 'CNY 699 / application asset', priceUsd: 'USD 99 / application asset', features: { full: '全機能を利用可能', usage: '商用利用が可能', automation: '自動更新ワークフロー', quota: '必要に応じてアプリケーション資産を購入、利用期限なし', support: '1 年間のバージョンアップとリモート技術サポート' } },
          enterprise: { summary: '大規模環境、プライベート配備、個別対応向け', price: '営業へお問い合わせ', features: { full: '全機能を利用可能', usage: '商用利用が可能', automation: '自動更新ワークフロー', approval: 'ワークフロー承認エンジンを含む', quota: '必要に応じてアプリケーション資産を購入、利用期限なし', customization: '要件に応じたカスタマイズ', support: '専任技術サポート' } },
        }
      },
      messages: { loadFailed: 'ライセンス状態の読み込みに失敗しました。', operationFailed: 'ライセンス操作に失敗しました。', exported: 'ライセンスファイルを出力しました。', requestExported: 'アクティベーション要求を出力しました。', invalidJson: '有効な JSON を入力してください。', licenseMissing: 'JSON にライセンスがありません。', imported: 'ライセンスを取り込みました。', importFailed: 'ライセンスの取り込みに失敗しました。' }
    }
  },
  'fr-FR': {
    licensing: {
      title: 'Licence produit',
      description: 'Consultez la licence de cette installation et gérez les fichiers de licence en ligne ou hors ligne.',
      summary: { title: 'État de la licence', unconfigured: 'Licence non configurée' },
      fields: { installationId: 'ID de l’installation', expiresAt: 'Expiration', graceEndsAt: 'Fin de la période de grâce', lastClockAt: 'Dernier contrôle de l’horloge' },
      states: { unlicensed: 'Sans licence', active: 'Active', grace: 'Période de grâce', expired: 'Expirée', revoked: 'Révoquée', clock_rollback_detected: 'Retour arrière de l’horloge détecté' },
      plans: { free: 'Gratuit', commercial: 'Commercial', enterprise: 'Entreprise', trial: 'Gratuit', standard: 'Commercial', professional: 'Commercial' },
      features: { title: 'Fonctionnalités sous licence', empty: 'Aucune fonctionnalité sous licence.' },
      quotas: { title: 'Quotas', managedTargets: 'Actifs applicatifs', concurrentExecutions: 'Exécutions simultanées', plugins: 'Extensions', unlimited: 'Illimité' },
      actions: { title: 'Fichiers de licence', description: 'Utilisez une demande en ligne pour les environnements connectés ou exportez une demande hors ligne.', upgrade: 'Mettre à niveau la licence', onlineRequest: 'Exporter une demande en ligne', offlineRequest: 'Exporter une demande hors ligne', export: 'Exporter la licence actuelle', importLabel: 'Importer le JSON de licence', importPlaceholder: 'Collez le contenu du fichier de licence', import: 'Importer la licence' },
      comparison: {
        title: 'Mettre à niveau la licence',
        subtitle: 'Comparez les versions avant de décider une mise à niveau.',
        currentPlan: 'Licence actuelle : {plan}',
        noActivePlan: 'Aucune licence active n’est encore importée. Consultez d’abord les différences entre versions.',
        badges: { current: 'Version actuelle', recommended: 'Mise à niveau recommandée' },
        footer: { consult: 'Conseil achat', faq: 'FAQ licence' },
        cards: {
          free: { summary: 'Pour l’évaluation, l’usage personnel et les charges légères', price: 'Utilisation gratuite', features: { full: 'Toutes les fonctionnalités sont disponibles', usage: 'Réservé à un usage non commercial', automation: 'Inclut les workflows de mise à jour automatisés', quota: 'Limité à 5 actifs applicatifs', support: 'Support communauté / e-mail' } },
          commercial: { summary: 'Pour la production standard et la montée en charge', priceCny: 'CNY 699 / application asset', priceUsd: 'USD 99 / application asset', features: { full: 'Toutes les fonctionnalités sont disponibles', usage: 'Utilisable en contexte commercial', automation: 'Workflows de mise à jour automatisés', quota: 'Achetez des actifs applicatifs selon vos besoins, avec une utilisation sans limite de durée', support: '1 an de mises à niveau et de support technique à distance' } },
          enterprise: { summary: 'Pour les grands environnements, la privatisation et les collaborations sur mesure', price: 'Contacter le service commercial', features: { full: 'Toutes les fonctionnalités sont disponibles', usage: 'Utilisable en contexte commercial', automation: 'Workflows de mise à jour automatisés', approval: 'Inclut le moteur d’approbation des workflows', quota: 'Achetez des actifs applicatifs selon vos besoins, avec une utilisation sans limite de durée', customization: 'Personnalisation selon vos besoins', support: 'Support technique dédié' } },
        }
      },
      messages: { loadFailed: 'Impossible de charger l’état de la licence.', operationFailed: 'Échec de l’opération de licence.', exported: 'Fichier de licence exporté.', requestExported: 'Demande d’activation exportée.', invalidJson: 'Saisissez un JSON valide.', licenseMissing: 'Le JSON ne contient pas de licence.', imported: 'Licence importée.', importFailed: 'Impossible d’importer la licence.' }
    }
  },
  'ru-RU': {
    licensing: {
      title: 'Лицензирование продукта',
      description: 'Просматривайте лицензию этой установки и работайте с онлайн- и офлайн-файлами лицензии.',
      summary: { title: 'Состояние лицензии', unconfigured: 'Лицензия не настроена' },
      fields: { installationId: 'ID установки', expiresAt: 'Истекает', graceEndsAt: 'Конец льготного периода', lastClockAt: 'Последняя проверка времени' },
      states: { unlicensed: 'Без лицензии', active: 'Действует', grace: 'Льготный период', expired: 'Истекла', revoked: 'Отозвана', clock_rollback_detected: 'Обнаружен откат времени' },
      plans: { free: 'Бесплатная', commercial: 'Коммерческая', enterprise: 'Корпоративная', trial: 'Бесплатная', standard: 'Коммерческая', professional: 'Коммерческая' },
      features: { title: 'Лицензированные функции', empty: 'Нет доступных лицензированных функций.' },
      quotas: { title: 'Лимиты', managedTargets: 'Активы приложений', concurrentExecutions: 'Параллельные выполнения', plugins: 'Плагины', unlimited: 'Без ограничений' },
      actions: { title: 'Файлы лицензии', description: 'Для подключенных сред используйте онлайн-запрос, а для изолированных сред экспортируйте офлайн-запрос.', upgrade: 'Обновить лицензию', onlineRequest: 'Экспорт онлайн-запроса', offlineRequest: 'Экспорт офлайн-запроса', export: 'Экспорт текущей лицензии', importLabel: 'Импорт JSON лицензии', importPlaceholder: 'Вставьте содержимое файла лицензии', import: 'Импортировать лицензию' },
      comparison: {
        title: 'Обновить лицензию',
        subtitle: 'Сравните версии лицензии перед тем, как решать вопрос об обновлении.',
        currentPlan: 'Текущая лицензия: {plan}',
        noActivePlan: 'Активная лицензия еще не импортирована. Сначала посмотрите различия между версиями.',
        badges: { current: 'Текущая версия', recommended: 'Рекомендуемое обновление' },
        footer: { consult: 'Консультация по покупке', faq: 'FAQ по лицензии' },
        cards: {
          free: { summary: 'Для оценки, личного использования и легких сценариев', price: 'Бесплатное использование', features: { full: 'Доступны все функции', usage: 'Только для некоммерческого использования', automation: 'Включены автоматизированные сценарии обновления', quota: 'До 5 активов приложений', support: 'Поддержка сообщества и по e-mail' } },
          commercial: { summary: 'Для стандартной продакшен-среды и роста по мере необходимости', priceCny: 'CNY 699 / application asset', priceUsd: 'USD 99 / application asset', features: { full: 'Доступны все функции', usage: 'Можно использовать в коммерческих сценариях', automation: 'Автоматизированные сценарии обновления', quota: 'Покупайте активы приложений по мере необходимости, использование без ограничения срока', support: '1 год обновлений версии и удалённой технической поддержки' } },
          enterprise: { summary: 'Для крупных сред, приватного развёртывания и кастомного сотрудничества', price: 'Связаться с отделом продаж', features: { full: 'Доступны все функции', usage: 'Можно использовать в коммерческих сценариях', automation: 'Автоматизированные сценарии обновления', approval: 'Включен движок согласования процессов', quota: 'Покупайте активы приложений по мере необходимости, использование без ограничения срока', customization: 'Кастомизация под требования', support: 'Выделенная техническая поддержка' } },
        }
      },
      messages: { loadFailed: 'Не удалось загрузить состояние лицензии.', operationFailed: 'Операция лицензирования завершилась ошибкой.', exported: 'Файл лицензии экспортирован.', requestExported: 'Запрос активации экспортирован.', invalidJson: 'Введите корректный JSON.', licenseMissing: 'В JSON отсутствует объект лицензии.', imported: 'Лицензия импортирована.', importFailed: 'Не удалось импортировать лицензию.' }
    }
  },
  'pt-BR': {
    licensing: {
      title: 'Licenciamento do produto',
      description: 'Consulte a licença desta instalação e gerencie arquivos de licença online ou offline.',
      summary: { title: 'Status da licença', unconfigured: 'Licença não configurada' },
      fields: { installationId: 'ID da instalação', expiresAt: 'Expira em', graceEndsAt: 'Fim do período de tolerância', lastClockAt: 'Última verificação do relógio' },
      states: { unlicensed: 'Sem licença', active: 'Ativa', grace: 'Período de tolerância', expired: 'Expirada', revoked: 'Revogada', clock_rollback_detected: 'Retrocesso do relógio detectado' },
      plans: { free: 'Gratuito', commercial: 'Comercial', enterprise: 'Empresarial', trial: 'Gratuito', standard: 'Comercial', professional: 'Comercial' },
      features: { title: 'Recursos licenciados', empty: 'Nenhum recurso licenciado disponível.' },
      quotas: { title: 'Cotas', managedTargets: 'Ativos de aplicações', concurrentExecutions: 'Execuções simultâneas', plugins: 'Plugins', unlimited: 'Ilimitado' },
      actions: { title: 'Arquivos de licença', description: 'Use uma solicitação online em ambientes conectados ou exporte uma solicitação offline para ambientes isolados.', upgrade: 'Atualizar licença', onlineRequest: 'Exportar solicitação online', offlineRequest: 'Exportar solicitação offline', export: 'Exportar licença atual', importLabel: 'Importar JSON da licença', importPlaceholder: 'Cole o conteúdo do arquivo de licença', import: 'Importar licença' },
      comparison: {
        title: 'Atualizar licença',
        subtitle: 'Compare as versões antes de decidir pela atualização.',
        currentPlan: 'Licença atual: {plan}',
        noActivePlan: 'Ainda não há uma licença ativa importada. Revise primeiro as diferenças entre as versões.',
        badges: { current: 'Versão atual', recommended: 'Upgrade recomendado' },
        footer: { consult: 'Consulta comercial', faq: 'FAQ da licença' },
        cards: {
          free: { summary: 'Para avaliação, uso pessoal e cenários leves', price: 'Uso gratuito', features: { full: 'Todos os recursos disponíveis', usage: 'Apenas para uso não comercial', automation: 'Inclui fluxos automatizados de atualização', quota: 'Limitado a 5 ativos de aplicações', support: 'Suporte por comunidade e e-mail' } },
          commercial: { summary: 'Para produção padrão e expansão sob demanda', priceCny: 'CNY 699 / application asset', priceUsd: 'USD 99 / application asset', features: { full: 'Todos os recursos disponíveis', usage: 'Pode ser usado em cenários comerciais', automation: 'Fluxos automatizados de atualização', quota: 'Compre ativos de aplicações conforme a necessidade, com uso por prazo ilimitado', support: '1 ano de atualizações de versão e suporte técnico remoto' } },
          enterprise: { summary: 'Para ambientes de grande porte, implantação privada e colaboração sob medida', price: 'Fale com vendas', features: { full: 'Todos os recursos disponíveis', usage: 'Pode ser usado em cenários comerciais', automation: 'Fluxos automatizados de atualização', approval: 'Inclui motor de aprovação de fluxos', quota: 'Compre ativos de aplicações conforme a necessidade, com uso por prazo ilimitado', customization: 'Customização conforme as necessidades', support: 'Suporte técnico dedicado' } },
        }
      },
      messages: { loadFailed: 'Falha ao carregar o status da licença.', operationFailed: 'Falha na operação de licença.', exported: 'Arquivo de licença exportado.', requestExported: 'Solicitação de ativação exportada.', invalidJson: 'Insira um JSON válido.', licenseMissing: 'O JSON não contém uma licença.', imported: 'Licença importada.', importFailed: 'Falha ao importar a licença.' }
    }
  },
  'ko-KR': {
    licensing: {
      title: '제품 라이선스',
      description: '이 설치의 라이선스 상태를 확인하고 온라인 또는 오프라인 라이선스 파일을 관리합니다.',
      summary: { title: '라이선스 상태', unconfigured: '라이선스가 설정되지 않음' },
      fields: { installationId: '설치 ID', expiresAt: '만료일', graceEndsAt: '유예 기간 종료', lastClockAt: '마지막 시간 확인' },
      states: { unlicensed: '라이선스 없음', active: '활성', grace: '유예 기간', expired: '만료됨', revoked: '해지됨', clock_rollback_detected: '시간 되돌림 감지' },
      plans: { free: '무료판', commercial: '상용판', enterprise: '엔터프라이즈', trial: '무료판', standard: '상용판', professional: '상용판' },
      features: { title: '허가된 기능', empty: '사용 가능한 허가 기능이 없습니다.' },
      quotas: { title: '할당량', managedTargets: '애플리케이션 자산', concurrentExecutions: '동시 실행', plugins: '플러그인', unlimited: '제한 없음' },
      actions: { title: '라이선스 파일', description: '연결된 환경은 온라인 요청을, 격리된 환경은 오프라인 요청을 사용합니다.', upgrade: '라이선스 업그레이드', onlineRequest: '온라인 요청 내보내기', offlineRequest: '오프라인 요청 내보내기', export: '현재 라이선스 내보내기', importLabel: '라이선스 JSON 가져오기', importPlaceholder: '라이선스 파일 내용을 붙여 넣으세요', import: '라이선스 가져오기' },
      comparison: {
        title: '라이선스 업그레이드',
        subtitle: '업그레이드 여부를 결정하기 전에 버전 차이를 비교합니다.',
        currentPlan: '현재 라이선스: {plan}',
        noActivePlan: '아직 활성 라이선스가 없습니다. 먼저 버전 차이를 확인하세요.',
        badges: { current: '현재 버전', recommended: '추천 업그레이드' },
        footer: { consult: '구매 상담', faq: '라이선스 FAQ' },
        cards: {
          free: { summary: '평가, 개인 사용, 경량 시나리오에 적합', price: '무료 사용', features: { full: '모든 기능 사용 가능', usage: '비상업적 용도에 한해 사용 가능', automation: '자동화 업데이트 워크플로 포함', quota: '애플리케이션 자산 5개까지', support: '커뮤니티 / 이메일 지원' } },
          commercial: { summary: '표준 운영 환경과 단계적 확장에 적합', priceCny: 'CNY 699 / application asset', priceUsd: 'USD 99 / application asset', features: { full: '모든 기능 사용 가능', usage: '상업적 시나리오에서 사용 가능', automation: '자동화 업데이트 워크플로', quota: '필요한 만큼 애플리케이션 자산을 구매하고 기간 제한 없이 사용', support: '1년 버전 업그레이드 및 원격 기술 지원' } },
          enterprise: { summary: '대규모 환경, 프라이빗 배포, 맞춤 협업에 적합', price: '영업팀 문의', features: { full: '모든 기능 사용 가능', usage: '상업적 시나리오에서 사용 가능', automation: '자동화 업데이트 워크플로', approval: '워크플로 승인 엔진 포함', quota: '필요한 만큼 애플리케이션 자산을 구매하고 기간 제한 없이 사용', customization: '요구사항에 따른 맞춤화', support: '전담 기술 지원' } },
        }
      },
      messages: { loadFailed: '라이선스 상태를 불러오지 못했습니다.', operationFailed: '라이선스 작업에 실패했습니다.', exported: '라이선스 파일을 내보냈습니다.', requestExported: '활성화 요청을 내보냈습니다.', invalidJson: '올바른 JSON을 입력하세요.', licenseMissing: 'JSON에 라이선스 객체가 없습니다.', imported: '라이선스를 가져왔습니다.', importFailed: '라이선스를 가져오지 못했습니다.' }
    }
  }
} as const satisfies Partial<Record<SupportedLocale, { readonly licensing: unknown }>>
