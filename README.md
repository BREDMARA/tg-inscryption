# Telegram Mini App MVP — «Комната ревью с финальным утверждением»

Этот репозиторий содержит рабочий MVP по вашему ТЗ:

- создание review-сессии;
- загрузка первой и последующих версий макета (изображения);
- комментарии по точкам на изображении;
- статусы комментариев (`open`, `in_progress`, `resolved`, `ignored`);
- история версий;
- финальное согласование отдельной кнопкой;
- лог действий по сессии;
- backend-валидация Telegram `initData` (эндпоинт `/auth/telegram`).

> Важно: для демо UI использует локальный `x-user-id` (без полноценного Telegram-клиента).
> Для production нужно запускать mini app внутри Telegram и передавать `initData` на `/auth/telegram`.

## Stack

- Frontend: Vanilla JS + HTML/CSS (mobile-first layout)
- Backend: Node.js (native HTTP server, без внешних зависимостей)
- Storage: JSON-файл `data/db.json` (для MVP)

## Запуск

```bash
npm start
```

Сервер стартует на `http://localhost:3000`.

## Как протестировать MVP вручную

1. Откройте `http://localhost:3000`.
2. Укажите `User ID` (например, `1`).
3. Создайте сессию:
   - название,
   - описание,
   - загрузите картинку.
4. Внутри сессии:
   - кликайте по макету, чтобы добавлять комментарии;
   - меняйте статусы комментариев;
   - загружайте новую версию;
   - жмите «Согласовать финально» (сработает только когда все комментарии `resolved`/`ignored`).

## API (MVP)

### Auth
- `POST /auth/telegram` — валидация `initData`, создание/логин пользователя.

### Sessions
- `POST /sessions`
- `GET /sessions`
- `GET /sessions/:id`
- `POST /sessions/:id/invite`
- `POST /sessions/:id/final-approve`

### Versions
- `POST /sessions/:id/versions`
- `GET /sessions/:id/versions`
- `GET /versions/:id`

### Comments
- `POST /versions/:id/comments`
- `GET /versions/:id/comments`
- `PATCH /comments/:id`
- `DELETE /comments/:id`

### Activity
- `GET /sessions/:id/activity`

## Ограничения текущего MVP

- Нет реального Telegram WebApp UI SDK интеграционного слоя в фронтенде (есть backend-валидация `initData`).
- Нет PostgreSQL/S3, используется локальный JSON-файл.
- Нет загрузки PDF/Figma в версии MVP.
- Нет websocket/polling-реалтайма (обновление вручную кнопкой «Обновить»).

## Следующие шаги

1. Перенести данные в PostgreSQL + Prisma/Drizzle.
2. Хранение файлов в S3/R2/MinIO + signed URLs.
3. Добавить Telegram Bot (инвайты и уведомления).
4. Добавить роли команды и тарифы.
5. Подключить Telegram Mini App SDK на клиенте.
