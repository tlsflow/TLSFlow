export const credentialsZhCN = {
  title: '凭据管理', description: '统一管理设备、插件和工作流使用的凭据档案。', empty: '暂无凭据。',
  actions: { refresh: '刷新', create: '新建凭据', save: '保存', close: '关闭', rotate: '轮换', enable: '启用', disable: '停用', delete: '删除' },
  columns: { name: '名称', kind: '类型', scope: '作用域', username: '用户名', status: '状态', updatedAt: '更新时间' },
  kinds: { USERNAME_PASSWORD: '用户名与密码', SSH_KEY: 'SSH 私钥', BEARER_TOKEN: 'Bearer Token', API_KEY: 'API Key', CLIENT_CERTIFICATE: '客户端证书' },
  scopes: { global: '全局', team: '团队', zone: '区域', host: '主机', plugin: '插件' },
  fields: { secretRef: 'Secret 引用', credential: '凭据', name: '名称', kind: '类型', scope: '作用域', scopeId: '作用域标识', username: '用户名', deliveryName: 'Header / Query 名称', primarySecret: '秘密值', secondarySecret: '私钥' },
  placeholders: { selectSecret: '请选择 Secret', select: '请选择凭据', primarySecret: '输入新的秘密值', secondarySecret: '输入新的私钥' },
  create: { title: '新建凭据' }, detail: { title: '凭据详情' }, rotate: { title: '轮换秘密值' }, usage: { title: '使用关系', empty: '当前没有引用。' }, errors: { load: '加载凭据失败', save: '保存凭据失败' },
} as const

export const credentialsZhTW = {
  title: '憑據管理', description: '統一管理裝置、外掛程式和工作流程使用的憑據檔案。', empty: '暫無憑據。', actions: { refresh: '重新整理', create: '新增憑據', save: '儲存', close: '關閉', rotate: '輪換', enable: '啟用', disable: '停用', delete: '刪除' },
  columns: { name: '名稱', kind: '類型', scope: '作用域', username: '使用者名稱', status: '狀態', updatedAt: '更新時間' },
  kinds: { USERNAME_PASSWORD: '使用者名稱與密碼', SSH_KEY: 'SSH 私鑰', BEARER_TOKEN: 'Bearer Token', API_KEY: 'API Key', CLIENT_CERTIFICATE: '用戶端憑證' },
  scopes: { global: '全域', team: '團隊', zone: '區域', host: '主機', plugin: '外掛程式' },
  fields: { secretRef: 'Secret 引用', credential: '憑據', name: '名稱', kind: '類型', scope: '作用域', scopeId: '作用域識別碼', username: '使用者名稱', deliveryName: 'Header / Query 名稱', primarySecret: '祕密值', secondarySecret: '私鑰' },
  placeholders: { selectSecret: '請選擇 Secret', select: '請選擇憑據', primarySecret: '輸入新的祕密值', secondarySecret: '輸入新的私鑰' },
  create: { title: '新增憑據' }, detail: { title: '憑據詳情' }, rotate: { title: '輪換祕密值' }, usage: { title: '使用關係', empty: '目前沒有引用。' }, errors: { load: '載入憑據失敗', save: '儲存憑據失敗' },
} as const

export const credentialsEnUS = {
  title: 'Credential Management', description: 'Manage credential profiles shared by devices, plugins, and workflows.', empty: 'No credentials.', actions: { refresh: 'Refresh', create: 'Create', save: 'Save', close: 'Close', rotate: 'Rotate', enable: 'Enable', disable: 'Disable', delete: 'Delete' },
  columns: { name: 'Name', kind: 'Kind', scope: 'Scope', username: 'Username', status: 'Status', updatedAt: 'Updated' },
  kinds: { USERNAME_PASSWORD: 'Username and password', SSH_KEY: 'SSH private key', BEARER_TOKEN: 'Bearer token', API_KEY: 'API key', CLIENT_CERTIFICATE: 'Client certificate' },
  scopes: { global: 'Global', team: 'Team', zone: 'Zone', host: 'Host', plugin: 'Plugin' },
  fields: { secretRef: 'Secret reference', credential: 'Credential', name: 'Name', kind: 'Kind', scope: 'Scope', scopeId: 'Scope ID', username: 'Username', deliveryName: 'Header / query name', primarySecret: 'Secret value', secondarySecret: 'Private key' },
  placeholders: { selectSecret: 'Select a secret', select: 'Select a credential', primarySecret: 'Enter a new secret value', secondarySecret: 'Enter a new private key' },
  create: { title: 'Create credential' }, detail: { title: 'Credential details' }, rotate: { title: 'Rotate secret values' }, usage: { title: 'Usage', empty: 'No current references.' }, errors: { load: 'Failed to load credentials', save: 'Failed to save credential' },
} as const

export const credentialsJaJP = {
  title: '資格情報管理', description: 'デバイス、プラグイン、ワークフローで共有する資格情報を管理します。', empty: '資格情報はありません。', actions: { refresh: '更新', create: '作成', save: '保存', close: '閉じる', rotate: 'ローテーション', enable: '有効化', disable: '無効化', delete: '削除' },
  columns: { name: '名前', kind: '種類', scope: 'スコープ', username: 'ユーザー名', status: '状態', updatedAt: '更新日時' },
  kinds: { USERNAME_PASSWORD: 'ユーザー名とパスワード', SSH_KEY: 'SSH 秘密鍵', BEARER_TOKEN: 'Bearer トークン', API_KEY: 'API キー', CLIENT_CERTIFICATE: 'クライアント証明書' }, scopes: { global: 'グローバル', team: 'チーム', zone: 'ゾーン', host: 'ホスト', plugin: 'プラグイン' },
  fields: { secretRef: 'Secret 参照', credential: '資格情報', name: '名前', kind: '種類', scope: 'スコープ', scopeId: 'スコープ ID', username: 'ユーザー名', deliveryName: 'Header / Query 名', primarySecret: 'シークレット値', secondarySecret: '秘密鍵' },
  placeholders: { selectSecret: 'Secret を選択', select: '資格情報を選択', primarySecret: '新しいシークレット値', secondarySecret: '新しい秘密鍵' },
  create: { title: '資格情報を作成' }, detail: { title: '資格情報の詳細' }, rotate: { title: 'シークレットを更新' }, usage: { title: '使用状況', empty: '参照はありません。' }, errors: { load: '資格情報の読み込みに失敗しました', save: '資格情報の保存に失敗しました' },
} as const

export const credentialsKoKR = {
  title: '자격 증명 관리', description: '장치, 플러그인 및 워크플로에서 공유하는 자격 증명을 관리합니다.', empty: '자격 증명이 없습니다.', actions: { refresh: '새로 고침', create: '생성', save: '저장', close: '닫기', rotate: '교체', enable: '활성화', disable: '비활성화', delete: '삭제' },
  columns: { name: '이름', kind: '유형', scope: '범위', username: '사용자 이름', status: '상태', updatedAt: '업데이트 시간' },
  kinds: { USERNAME_PASSWORD: '사용자 이름 및 암호', SSH_KEY: 'SSH 개인 키', BEARER_TOKEN: 'Bearer 토큰', API_KEY: 'API 키', CLIENT_CERTIFICATE: '클라이언트 인증서' }, scopes: { global: '전역', team: '팀', zone: '영역', host: '호스트', plugin: '플러그인' },
  fields: { secretRef: 'Secret 참조', credential: '자격 증명', name: '이름', kind: '유형', scope: '범위', scopeId: '범위 ID', username: '사용자 이름', deliveryName: 'Header / Query 이름', primarySecret: '비밀 값', secondarySecret: '개인 키' },
  placeholders: { selectSecret: 'Secret을 선택하세요', select: '자격 증명을 선택하세요', primarySecret: '새 비밀 값을 입력하세요', secondarySecret: '새 개인 키를 입력하세요' },
  create: { title: '자격 증명 생성' }, detail: { title: '자격 증명 상세' }, rotate: { title: '비밀 값 교체' }, usage: { title: '사용 관계', empty: '현재 참조가 없습니다.' }, errors: { load: '자격 증명을 불러오지 못했습니다', save: '자격 증명을 저장하지 못했습니다' },
} as const

export const credentialsFrFR = {
  title: 'Gestion des identifiants', description: 'Gérer les profils partagés par les appareils, les plugins et les workflows.', empty: 'Aucun identifiant.', actions: { refresh: 'Actualiser', create: 'Créer', save: 'Enregistrer', close: 'Fermer', rotate: 'Renouveler', enable: 'Activer', disable: 'Désactiver', delete: 'Supprimer' },
  columns: { name: 'Nom', kind: 'Type', scope: 'Portée', username: 'Utilisateur', status: 'État', updatedAt: 'Mise à jour' },
  kinds: { USERNAME_PASSWORD: 'Utilisateur et mot de passe', SSH_KEY: 'Clé privée SSH', BEARER_TOKEN: 'Jeton Bearer', API_KEY: 'Clé API', CLIENT_CERTIFICATE: 'Certificat client' }, scopes: { global: 'Globale', team: 'Équipe', zone: 'Zone', host: 'Hôte', plugin: 'Plugin' },
  fields: { secretRef: 'Référence Secret', credential: 'Identifiant', name: 'Nom', kind: 'Type', scope: 'Portée', scopeId: 'ID de portée', username: 'Utilisateur', deliveryName: 'Nom Header / Query', primarySecret: 'Valeur secrète', secondarySecret: 'Clé privée' },
  placeholders: { selectSecret: 'Sélectionner un secret', select: 'Sélectionner un identifiant', primarySecret: 'Saisir une nouvelle valeur secrète', secondarySecret: 'Saisir une nouvelle clé privée' },
  create: { title: 'Créer un identifiant' }, detail: { title: 'Détails de l’identifiant' }, rotate: { title: 'Renouveler les secrets' }, usage: { title: 'Utilisation', empty: 'Aucune référence actuelle.' }, errors: { load: 'Échec du chargement des identifiants', save: 'Échec de l’enregistrement' },
} as const

export const credentialsPtBR = {
  title: 'Gerenciamento de credenciais', description: 'Gerencie perfis compartilhados por dispositivos, plugins e fluxos de trabalho.', empty: 'Nenhuma credencial.', actions: { refresh: 'Atualizar', create: 'Criar', save: 'Salvar', close: 'Fechar', rotate: 'Rotacionar', enable: 'Ativar', disable: 'Desativar', delete: 'Excluir' },
  columns: { name: 'Nome', kind: 'Tipo', scope: 'Escopo', username: 'Usuário', status: 'Status', updatedAt: 'Atualizado em' },
  kinds: { USERNAME_PASSWORD: 'Usuário e senha', SSH_KEY: 'Chave privada SSH', BEARER_TOKEN: 'Token Bearer', API_KEY: 'Chave de API', CLIENT_CERTIFICATE: 'Certificado de cliente' }, scopes: { global: 'Global', team: 'Equipe', zone: 'Zona', host: 'Host', plugin: 'Plugin' },
  fields: { secretRef: 'Referência de Secret', credential: 'Credencial', name: 'Nome', kind: 'Tipo', scope: 'Escopo', scopeId: 'ID do escopo', username: 'Usuário', deliveryName: 'Nome do Header / Query', primarySecret: 'Valor secreto', secondarySecret: 'Chave privada' },
  placeholders: { selectSecret: 'Selecione um Secret', select: 'Selecione uma credencial', primarySecret: 'Digite um novo valor secreto', secondarySecret: 'Digite uma nova chave privada' },
  create: { title: 'Criar credencial' }, detail: { title: 'Detalhes da credencial' }, rotate: { title: 'Rotacionar segredos' }, usage: { title: 'Uso', empty: 'Nenhuma referência atual.' }, errors: { load: 'Falha ao carregar credenciais', save: 'Falha ao salvar credencial' },
} as const

export const credentialsRuRU = {
  title: 'Управление учетными данными', description: 'Управление профилями для устройств, плагинов и рабочих процессов.', empty: 'Учетных данных нет.', actions: { refresh: 'Обновить', create: 'Создать', save: 'Сохранить', close: 'Закрыть', rotate: 'Сменить', enable: 'Включить', disable: 'Отключить', delete: 'Удалить' },
  columns: { name: 'Имя', kind: 'Тип', scope: 'Область', username: 'Пользователь', status: 'Статус', updatedAt: 'Обновлено' },
  kinds: { USERNAME_PASSWORD: 'Имя пользователя и пароль', SSH_KEY: 'Закрытый ключ SSH', BEARER_TOKEN: 'Bearer-токен', API_KEY: 'Ключ API', CLIENT_CERTIFICATE: 'Клиентский сертификат' }, scopes: { global: 'Глобальная', team: 'Команда', zone: 'Зона', host: 'Узел', plugin: 'Плагин' },
  fields: { secretRef: 'Ссылка на Secret', credential: 'Учетные данные', name: 'Имя', kind: 'Тип', scope: 'Область', scopeId: 'ID области', username: 'Имя пользователя', deliveryName: 'Имя Header / Query', primarySecret: 'Секретное значение', secondarySecret: 'Закрытый ключ' },
  placeholders: { selectSecret: 'Выберите Secret', select: 'Выберите учетные данные', primarySecret: 'Введите новое секретное значение', secondarySecret: 'Введите новый закрытый ключ' },
  create: { title: 'Создать учетные данные' }, detail: { title: 'Сведения об учетных данных' }, rotate: { title: 'Сменить секреты' }, usage: { title: 'Использование', empty: 'Текущих ссылок нет.' }, errors: { load: 'Не удалось загрузить учетные данные', save: 'Не удалось сохранить учетные данные' },
} as const
