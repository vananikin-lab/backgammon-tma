# 🎲 Нарды — Telegram Mini App

Онлайн-нарды для двух игроков в Telegram. Поддерживает короткие и длинные нарды, матчмейкинг и приглашения по ссылке.

---

## Структура проекта

```
backgammon-tma/
├── server/
│   ├── index.js        ← Express + WebSocket сервер
│   ├── gameLogic.js    ← Логика игры (правила, ходы, победа)
│   └── package.json
└── client/
    └── index.html      ← Telegram Mini App (один файл)
```

---

## Шаг 1 — Создать Telegram бота

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram
2. Отправьте `/newbot`, дайте боту имя и username (например `NardyOnlineBot`)
3. Сохраните токен вида `123456789:AAF...`
4. Отправьте `/newapp` → выберите вашего бота → задайте Mini App

---

## Шаг 2 — Деплой на Railway (бесплатно)

### 2.1 Подготовка

```bash
cd backgammon-tma
git init
git add .
git commit -m "init"
```

### 2.2 Деплой

1. Зайдите на [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
2. Подключите репозиторий
3. Railway автоматически запустит `npm start` из папки `server/`
4. В разделе **Settings → Variables** добавьте:
   ```
   PORT=3000
   ```
5. Включите **Custom Domain** или скопируйте публичный URL вида `https://your-app.up.railway.app`

> **Альтернатива:** [Render.com](https://render.com) — аналогичный процесс, тоже бесплатный tier.

---

## Шаг 3 — Настроить Mini App URL

1. Откройте @BotFather → `/myapps` → выберите ваш Mini App
2. Укажите **Web App URL**: `https://your-app.up.railway.app`
3. Убедитесь что Railway раздаёт `client/index.html` (Express делает это автоматически через `express.static`)

---

## Шаг 4 — Настроить ссылку-приглашение

В файле `client/index.html` найдите строку:

```js
const botName = 'BackgammonTestBot'; // ← замените на имя вашего бота
```

Замените `BackgammonTestBot` на username вашего бота.

Ссылка-приглашение будет иметь вид:
```
https://t.me/НашБот?startapp=game_GAMEID
```

Чтобы бот обрабатывал эту ссылку — добавьте в бота обработчик `/start game_GAMEID` и открывайте Mini App с параметром `?game=GAMEID`.

---

## Шаг 5 — Telegram Bot (опционально, для старта через команду)

Минимальный бот на Node.js:

```js
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot('ВАШ_ТОКЕН', { polling: true });

bot.onText(/\/start(.*)/, (msg, match) => {
  const param = (match[1] || '').trim(); // 'game_GAMEID' или пусто
  const gameParam = param.startsWith('game_') ? param.replace('game_', '') : '';
  const url = `https://your-app.up.railway.app${gameParam ? '?game=' + gameParam : ''}`;

  bot.sendMessage(msg.chat.id, '🎲 Играть в нарды!', {
    reply_markup: {
      inline_keyboard: [[{
        text: '🎮 Открыть игру',
        web_app: { url }
      }]]
    }
  });
});
```

Установка: `npm install node-telegram-bot-api`

---

## Правила нард

### Короткие нарды (стандартные)
- Шашки расставляются по классической схеме
- Можно бить одиночную шашку соперника (блот) и отправлять на бар
- Шашка с бара должна войти первой

### Длинные нарды
- Все 15 шашек начинают на одном поле (угол соперника)
- Нельзя занимать поле, занятое любым количеством шашек соперника
- Бить шашки нельзя

---

## Локальный запуск (тест без Telegram)

```bash
cd server
npm install
npm start
# Откройте http://localhost:3000 в браузере
# Откройте во втором окне — будет матчмейкинг
```
