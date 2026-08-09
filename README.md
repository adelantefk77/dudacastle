# DudaCastle

Cyfrowa, wieloosobowa adaptacja gry karciano-planszowej (React + Vite frontend, Fastify +
Socket.IO backend, opcjonalna trwałość Prisma/Postgres).

## Rozwój lokalny

```bash
npm install
npm run dev:server   # backend na :4000
npm run dev:web      # frontend na :5173 (proxy do :4000 przez VITE_SERVER_URL)
```

## Wdrożenie na Railway

Projekt jest skonfigurowany jako **jeden serwis**: Fastify serwuje jednocześnie API,
WebSocket (Socket.IO) i zbudowany frontend (`apps/web/dist`) z tego samego originu — bez
CORS-a i bez cross-origin WebSocketu w produkcji.

1. Połącz repozytorium z Railway (nowy projekt → Deploy from GitHub repo).
2. Railway wykryje `railway.json` w katalogu głównym — build: `npm install && npm run build`,
   start: `npm start`. Zmienna `PORT` jest wstrzykiwana automatycznie przez Railway.
3. **Trwałość (opcjonalna)**: bez bazy danych gra działa w pełni w pamięci procesu (mecze
   znikają po restarcie). Żeby włączyć historię/reconnect:
   - dodaj plugin **PostgreSQL** w projekcie Railway (automatycznie ustawi `DATABASE_URL`),
   - jednorazowo zsynchronizuj schemat: `railway run npm run db:push` (albo lokalnie z
     `DATABASE_URL` ustawionym na bazę Railway).
4. Domyślnie CORS/Socket.IO są ustawione permisywnie (`origin: "*"` / `true`) — do
   ewentualnego zawężenia w `apps/server/src/index.ts`, jeśli frontend miałby być serwowany
   z osobnej domeny.

### Zmienne środowiskowe

| Zmienna | Wymagana | Opis |
|---|---|---|
| `PORT` | nie (Railway ustawia sama) | Port, na którym nasłuchuje serwer |
| `DATABASE_URL` | nie | Connection string Postgres — włącza trwałość meczów |
