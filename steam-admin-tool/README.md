# steam-admin-tool

Инструмент для **администрирования собственных групп и обсуждений Steam**.
Позволяет владельцу сообщества использовать пул аккаунтов-помощников (до 50)
для публикации комментариев на стене группы и в темах обсуждений **по расписанию**,
с человеческими паузами, ротацией аккаунтов и защитой от rate-limit.

> ⚠️ См. раздел [Ответственное использование](#ответственное-использование) ниже.

## Возможности

- **Два метода авторизации** (настраивается на каждый аккаунт):
  - **QR-логин** — генерация QR-кода через `steam-user`, сканирование мобильным приложением Steam; refresh-токен сохраняется, повторный скан не нужен.
  - **SDA (maFile)** — загрузка `.maFile` из Steam Desktop Authenticator, автоматическая генерация 2FA-кода через `steam-totp`.
- **Мультиаккаунтность**: пул с батчевым логином (`maxConcurrentLogins`, стаггер между батчами), ротация «least-recently-used», автопереподключение с экспоненциальным backoff.
- **Постинг**: комментарии в темы обсуждений (`commentOnDiscussion`) и на стену группы (`postGroupComment`).
- **Очередь задач**: `config/tasks.json` c `{type: "discussion"|"wall", groupId, topicId?, textKey, scheduledAt, status}`. Планировщик — собственный tick-цикл + `node-cron` для ежедневного отчёта.
- **Тексты**: `config/texts.json`, случайный выбор без повторений в рамках сессии (использованные индексы хранятся в state), плейсхолдеры `{group_name}`, `{date}`, `{random_emoji}`.
- **Anti-abuse ограничения** (не обход, а соблюдение лимитов): пауза 60–180 с между действиями аккаунта, 15–40 мин между действиями разных аккаунтов в одной группе, ≤1 комментария/час/аккаунт/группа, backoff 5→15→45→135 мин при 429.
- **Логирование**: `logs/auth.log`, `logs/actions.log`, `logs/errors.log` (winston + daily-rotate), ежедневный отчёт в консоль.

## Архитектура

```
steam-admin-tool/
├── src/
│   ├── auth/
│   │   ├── qrLogin.js        # QR-логин steam-user + сохранение refresh-токенов
│   │   └── sdaLogin.js       # чтение maFile, генерация 2FA через steam-totp
│   ├── accounts/
│   │   ├── pool.js           # пул аккаунтов: батч-логины, ротация LRU, shutdown
│   │   └── session.js        # одна сессия: SteamUser + SteamCommunity, реконнект
│   ├── actions/
│   │   ├── groupWall.js      # postGroupComment
│   │   └── discussions.js    # commentOnDiscussion
│   ├── scheduler/
│   │   └── taskRunner.js     # очередь tasks.json, лимиты, отчёты
│   ├── utils/
│   │   ├── rateLimiter.js    # паузы, межгрупповой gap, hourly cap, backoff
│   │   ├── textProvider.js   # тексты + плейсхолдеры, без повторений
│   │   ├── stateStore.js     # lowdb (ESM) обёртка состояния (data/state.json)
│   │   └── logger.js         # winston: auth/actions/errors + консоль
│   └── index.js              # entry point, CLI-режимы, graceful shutdown
├── config/
│   ├── config.json           # тайминги, лимиты, реконнект, логирование
│   ├── accounts.json         # секреты! chmod 600, в .gitignore
│   ├── accounts.json.example # шаблон
│   ├── tasks.json            # очередь задач
│   └── texts.json            # массив строк-шаблонов
├── data/                     # состояние (state.json, chmod 600)
├── logs/                     # rotating logs
└── package.json
```

### Поток данных

```
accounts.json ──> AccountPool ──> AccountSession[] (SteamUser + SteamCommunity)
                                          ▲
tasks.json ──> TaskRunner (tick) ──> RateLimiter ──> TextProvider(texts.json)
                        │                                   │
                        └──── actions/{groupWall,discussions}.js ────> Steam
                                        │
                         state.json (cooldowns, токены, статистика)
                         logs/*.log + ежедневный отчёт (node-cron)
```

## Установка

Требования: **Node.js ≥ 18 LTS** (рекомендуется 20/22 LTS), Linux/macOS (chmod) или Windows с WSL.

```bash
cd steam-admin-tool
npm install
```

## Конфигурация

### config/config.json
Ключевые поля (полный пример — в репозитории):

| Поле | Значение по умолчанию | Смысл |
|---|---|---|
| `pool.maxConcurrentLogins` | 3 | сколько аккаунтов логинится одновременно |
| `pool.loginStaggerMs` | 20000 | пауза между батчами логинов |
| `posting.humanPauseMinMs/MaxMs` | 60000/180000 | пауза между действиями одного аккаунта |
| `posting.crossAccountGroupGapMinMs/MaxMs` | 900000/2400000 | пауза между разными аккаунтами в одной группе (15–40 мин) |
| `posting.maxCommentsPerHourPerAccountPerGroup` | 1 | жёсткий лимит Steam |
| `posting.backoffSequenceMin` | [5,15,45,135] | экспоненциальный backoff при 429 |
| `auth.reconnect.*` | base 30s → max 15min, 8 попыток | автопереподключение |
| `scheduler.dailyReportCron` | `0 9 * * *` | ежедневный отчёт |

### config/accounts.json (⚠️ секреты)

```bash
cp config/accounts.json.example config/accounts.json
chmod 600 config/accounts.json
nano config/accounts.json
```

Структура аккаунта:

```jsonc
{
  "id": "helper01",
  "steamId": "76561198000000001",
  "authMethod": "sda",              // или "qr"
  "maFile": "secrets/helper01.maFile", // путь к SDA-файлу (для sda)
  "groups": [
    { "groupId": "35482003010697271", "groupPermalink": "my-own-group-one" }
  ],
  "enabled": true
}
```

Приложение **откажется запускаться**, если у `accounts.json` права не `600`
(настраивается через `security.enforceAccountsChmod`).

### config/tasks.json

```json
{
  "id": "task-0001",
  "type": "discussion",            // "discussion" | "wall"
  "groupId": "35482003010697271",
  "groupPermalink": "my-own-group-one",
  "topicId": "398221778518503312", // только для discussion
  "textKey": 0,                    // индекс строки в texts.json, или null = рандом
  "scheduledAt": "2026-10-27T10:00:00.000Z",
  "assignedAccount": null,         // или "helper01" — иначе ротация LRU
  "status": "pending"              // pending -> running -> done | failed_retryable | blocked_captcha | skipped
}
```

### config/texts.json
Массив строк. Поддерживаются плейсхолдеры `{group_name}`, `{date}`, `{random_emoji}`.

## Пошаговый запуск

> 📖 Подробная пошаговая инструкция по установке и первому запуску — в файле [`INSTALL-QUICKSTART.md`](../INSTALL-QUICKSTART.md) (клонирование, конфиги, первый QR-логин, импорт maFile, проверка перед боевым запуском).

### Шаг 1. Установка
```bash
npm install
```

### Шаг 2. Настройка конфигов
```bash
cp config/accounts.json.example config/accounts.json
chmod 600 config/accounts.json
# отредактируйте accounts.json, config.json, texts.json, tasks.json
```

### Шаг 3а. Первый QR-логин (для аккаунтов с `"authMethod": "qr"`)
```bash
node src/index.js --login-qr --account helper02
```
В консоли появится QR-код. Откройте **Steam Mobile → QR-код** (или подтвердите вход
в уведомлении). После успеха refresh-токен сохранится в `data/state.json` —
**сканировать нужно только один раз**, дальше вход происходит молча.

### Шаг 3б. Импорт maFile (для аккаунтов с `"authMethod": "sda"`)
1. Установите [Steam Desktop Authenticator](https://github.com/Jessecar96/SteamDesktopAuthenticator).
2. Привяжите Mobile Authenticator нужного аккаунта и дождитесь появления файла
   `<steamId>.maFile` в папке SDA.
3. Скопируйте файл в проект:
   ```bash
   mkdir -p secrets
   cp /path/to/SDA/<steamId>.maFile secrets/helper01.maFile
   chmod 600 secrets/*.maFile
   ```
4. Укажите путь в `accounts.json` (`"maFile": "secrets/helper01.maFile"`).
   2FA-код (`steam-totp`) будет генерироваться автоматически из `shared_secret`.

### Шаг 4. Запуск основного сервиса
```bash
npm start
```
Пузалогинит аккаунты батчами, планировщик начнёт обрабатывать очередь `tasks.json`.

### Полезные команды
```bash
npm run report          # ежедневный отчёт прямо сейчас
npm run login:qr -- --account helper03
```

## Troubleshooting

| Ошибка | Причина | Как ведёт себя программа |
|---|---|---|
| **HTTP 429 / TooManyRequests** | Слишком много запросов к steamcommunity | Экспоненциальный backoff 5→15→45→135 мин (счётчик в state.json, переживает рестарт). Задача получает новый `scheduledAt`, аккаунт не исключается навсегда. После успешного действия счётчик сбрасывается. |
| **LogonSessionReplaced / AlreadyLoggedInSameSteamID** | Вы залогинились в этот аккаунт вручную (игра/браузер/другой бот) | Событие `kicked`: процесс **не падает**, аккаунт помечается offline, реконнект откладывается на ~15 минут (чтобы не устроить «войну сессий»). Закройте другие клиенты или оставьте как есть. |
| **LoggedInElsewhere** | То же самое, другой код EResult | Обрабатывается идентично `LogonSessionReplaced`. |
| **CaptchaRequired / Locked** | Steam запросил капчу | **Обход не выполняется** (это было бы нарушением правил). Задача помечается `blocked_captcha`, аккаунт паркуется, в errors.log — инструкция: зайдите на steamcommunity.com под этим аккаунтом из браузера и решите капчу вручную, затем снимите статус. |
| **InvalidPassword / InvalidTwoFactorCode** | Неверный пароль или рассинхрон времени | Логин этого аккаунта откладывается с backoff-реконнектом (30с→15мин, до 8 попыток). Проверьте системное время (TOTP чувствителен к skew) и корректность maFile. |
| **sessionExpired (web)** | Протухла web-сессия community | steam-user пересоздаёт webSession, cookies обновляются автоматически (`webSession` event). Действий это не прерывает. |
| **disconnected (EResult)** | Обрыв CS-соединения | Автопереподключение с экспоненциальной задержкой; cooldown'ы сохраняются в state.json. |
| Аккаунт «пропал» из ротации | Он offline | Планировщик выбирает только online-сессии; задача остаётся `pending` и выполнится, когда аккаунт вернётся. |

## Ответственное использование

- **Используйте инструмент ТОЛЬКО со своими собственными группами и обсуждениями**
  (или где вы являетесь модератором и участники согласны).
- Массовые однотипные комментарии в чужих сообществах — это **спам**. Последствия:
  **Community Ban** аккаунтов-помощников (часто перманентный), ограничение
  возможностей аккаунта, а при массовости — бан всех аккаунтов с одного IP/устройства.
- Программа сознательно **не делает** того, что нарушает Steam SSN:
  нет ротации прокси, нет обхода CAPTCHA, нет автоматического создания аккаунтов,
  нет превышения лимита «комментариев в час». Все паузы можно только увеличивать.
- Даже на своих группах держите консервативные лимиты (1 комментарий/час/аккаунт)
  и не добавляйте сотни одинаковых по смыслу постов за короткий срок — Steam может
  флагнуть активность как bot-like независимо от прав собственности на группу.
- Храните `accounts.json` и `*.maFile` под chmod 600, не коммитьте их в git
  (уже настроено в `.gitignore`) и используйте для помощников **отдельные**
  аккаунты без инвентаря и платёжных данных.

## Лицензия
MIT
