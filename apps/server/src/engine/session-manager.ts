import { nanoid } from "nanoid";

/**
 * Naprawia lukę bezpieczeństwa z audytu: wcześniej `socket.on("action", ...)` ufał polu
 * `matchPlayerId` przysłanemu w treści wiadomości bez żadnej weryfikacji, więc dowolny klient
 * mógł podać się za innego gracza (np. zaatakować jego jednostki, zakończyć mu turę).
 *
 * Nie budujemy pełnego systemu kont — `SessionManager` wydaje losowy, nieodgadnialny token przy
 * zajęciu miejsca w lobby (POST /lobbies, POST /lobbies/:id/join). Klient musi przedstawić ten
 * token przy `join_match`; serwer wiąże go z konkretnym socketem (`socket.data`) i od tej pory
 * ignoruje jakikolwiek `matchPlayerId` przysłany w payloadzie akcji na rzecz tożsamości
 * potwierdzonej dla TEGO socketu.
 */
interface Session {
  token: string;
  matchPlayerId: string;
  matchId: string | null;
}

export class SessionManager {
  private byToken = new Map<string, Session>();
  private tokenByMatchPlayerId = new Map<string, string>();

  /** Wywoływane przy zajęciu miejsca w lobby — zwraca token, który trzeba oddać wyłącznie temu graczowi. */
  register(matchPlayerId: string): string {
    const token = nanoid(32);
    this.byToken.set(token, { token, matchPlayerId, matchId: null });
    this.tokenByMatchPlayerId.set(matchPlayerId, token);
    return token;
  }

  /** Wywoływane, gdy lobby przechodzi w mecz — dopina matchId do już wydanych tokenów tych miejsc. */
  attachMatch(matchPlayerId: string, matchId: string): void {
    const token = this.tokenByMatchPlayerId.get(matchPlayerId);
    if (!token) return;
    const session = this.byToken.get(token);
    if (session) session.matchId = matchId;
  }

  /** true tylko gdy token istnieje i faktycznie odpowiada podanej parze (matchId, matchPlayerId). */
  verify(token: string, matchId: string, matchPlayerId: string): boolean {
    const session = this.byToken.get(token);
    return !!session && session.matchPlayerId === matchPlayerId && session.matchId === matchId;
  }
}
