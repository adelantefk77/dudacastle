/**
 * Domyślnie ten sam origin co strona (produkcja: Fastify serwuje zbudowany frontend i
 * API/WebSocket z jednego procesu — zob. apps/server/src/index.ts). W trybie dev frontend
 * (Vite, :5173) i backend (:4000) to różne originy — override przez VITE_SERVER_URL w
 * apps/web/.env.development.
 */
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? window.location.origin;
