# Быстрый старт (Quick Start)

Пошаговая инструкция по установке и первому запуску **steam-admin-tool**.
Рассчитана на Linux/macOS (или Windows через WSL). Требуется **Node.js ≥ 18 LTS** (рекомендуется 20/22).

---

## 1. Клонирование и установка

```bash
git clone https://github.com/denz1208-blip/SpamSt.git
cd SpamSt/steam-admin-tool
npm install
```

Проверка версии Node:

```bash
node -v   # должно быть v18+ (лучше v20/v22 LTS)
```

---

## 2. Настройка конфигурации

### 2.1. Основной конфиг (`config/config.json`)

Уже содержит безопасные значения по умолчанию (паузы 60–180 с, лимит 1 коммент/час/аккаунт/группу, backoff 5→15→45→135 мин). При необходимости отредактируйте:

```bash
nano config/config.json
```

### 2.2. Аккаунты (`config/accounts.json`) — ⚠️ секреты

```bash
cp config/accounts.json.example config/accounts.json
chmod 600 config/accounts.json
nano config/accounts.json
```

Добавьте хотя бы один аккаунт-помощник:

```jsonc
{
  "id": "helper01",
  "steamId": "76561198000000001",
  "authMethod": "sda",                  // или "qr"
  "maFile": "secrets/helper01.maFile",  // только для sda
  "groups": [
    { "groupId": "35482003010697271", "groupPermalink": "my-own-group-one" }
  ],
  "enabled": true
}
```

> Приложение **откажется запускаться**, если права на `accounts.json` не `600`.
> Файл `accounts.json` и папка `secrets/` находятся в `.gitignore` — они никогда не попадут в репозиторий.

### 2.3. Тексты (`config/texts.json`)

Массив строк-шаблонов. Поддерживаются плейсхолдеры `{group_name}`, `{date}`, `{random_emoji}`:

```json
[
  "Спасибо за обсуждение! {random_emoji}",
  "Привет участникам {group_name}, сегодня {date} ✨"
]
```

### 2.4. Задачи (`config/tasks.json`)

Очередь задач. Пример задачи:

```json
{
  "id": "task-0001",
  "type": "discussion",
  "groupId": "35482003010697271",
  "groupPermalink": "my-own-group-one",
  "topicId": "398221778518503312",
  "textKey": null,
  "scheduledAt": "2026-10-27T10:00:00.000Z",
  "assignedAccount": null,
  "status": "pending"
}
```

Где взять `groupId` / `topicId`:
- **groupId** — числовой ID группы (видно при редактировании группы или через API `ISteamCommunity`).
- **groupPermalink** — часть URL группы: `steamcommunity.com/groups/<permalink>`.
- **topicId** — из URL темы обсуждения: `.../discussions/<permalink>/topic/<topicId>/`.

---

## 3. Первый вход

### Вариант А: QR-логин (без пароля и SDA)

```bash
node src/index.js --login-qr --account helper02
```

1. В консоли появится QR-код.
2. Откройте на телефоне **Steam Mobile → значок QR-кода** (или подтвердите push-уведомление о входе).
3. После успешного входа refresh-токен сохранится в `data/state.json` — **сканировать нужно только один раз**, дальнейшие входы происходят автоматически.

### Вариант Б: SDA (maFile)

1. Установите [Steam Desktop Authenticator](https://github.com/Jessecar96/SteamDesktopAuthenticator).
2. Привяжите Mobile Authenticator к аккаунту-помощнику и дождитесь появления файла `<steamId>.maFile` в папке SDA.
3. Скопируйте файл в проект:

```bash
mkdir -p secrets
cp /path/to/SDA/<steamId>.maFile secrets/helper01.maFile
chmod 600 secrets/*.maFile
```

4. Укажите путь в `accounts.json` (`"maFile": "secrets/helper01.maFile"`).
   2FA-код будет генерироваться автоматически через `steam-totp` из `shared_secret`.
   Пароль аккаунта задаётся в поле `"password"` того же объекта аккаунта (хранится локально, chmod 600).

---

## 4. Запуск сервиса

```bash
npm start
```

Что произойдёт:
1. Пул залогинит аккаунты батчами (по `pool.maxConcurrentLogins`, со стаггером).
2. Планировщик начнёт обрабатывать очередь `tasks.json` с учётом всех пауз и лимитов.
3. Логи пишутся в `logs/auth.log`, `logs/actions.log`, `logs/errors.log`.

Полезные команды:

```bash
npm run report                     # ежедневный отчёт прямо сейчас
node src/index.js --login-qr --account helper03   # добавить QR-аккаунт
```

Остановка: `Ctrl+C` (graceful shutdown — сессии корректно закрываются, состояние сохраняется).

---

## 5. Проверка перед боевым запуском

1. Создайте **тестовую задачу** на свою группу с `scheduledAt` через 2 минуты.
2. Запустите `npm start` и дождитесь выполнения.
3. Проверьте комментарий на стене/в теме и запись в `logs/actions.log`.
4. Только после этого наполняйте очередь реальными задачами.

---

## 6. Безопасность (обязательно)

- `chmod 600 config/accounts.json data/state.json secrets/*.maFile`
- Никогда не коммитьте `accounts.json`, `*.maFile`, `state.json` (уже в `.gitignore`).
- Используйте для помощников отдельные аккаунты **без инвентаря и платёжных данных**.
- Подробнее — раздел «Ответственное использование» в [README](steam-admin-tool/README.md).

Если что-то из секретов случайно попало в git — немедленно отвязывайте мобильный аутентификатор, меняйте пароли и удаляйте историю коммитов (`git filter-repo`).

---

## 7. Типичные проблемы

См. таблицу Troubleshooting в [README](steam-admin-tool/README.md): RateLimit (429), LogonSessionReplaced, CaptchaRequired, InvalidTwoFactorCode и др. — все обрабатываются программой автоматически, кроме капчи (её нужно решить вручную в браузере).
