import { SERVER_URL } from "./config";

export interface LobbySeatDto {
  matchPlayerId: string;
  userId: string;
  kingdomId: string;
  displayName: string;
  isBot?: boolean;
}

export interface LobbyResponse {
  lobbyId: string;
  matchPlayerId: string;
  /** Token autoryzujący ten socket do sterowania tym miejscem — wymagany przy `join_match`. */
  token: string;
  maxPlayers: number;
  seats: LobbySeatDto[];
  matchId?: string | null;
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { message?: string } | null)?.message ?? `Błąd żądania (${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

export async function createLobby(params: {
  maxPlayers: number;
  kingdomId: string;
  userId: string;
  displayName: string;
  /** Natychmiast dopełnia pozostałe miejsca botami i startuje mecz bez czekania na innych graczy. */
  fillWithBots?: boolean;
}): Promise<LobbyResponse> {
  const response = await fetch(`${SERVER_URL}/lobbies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow<LobbyResponse>(response);
}

export async function joinLobby(
  lobbyId: string,
  params: { kingdomId: string; userId: string; displayName: string },
): Promise<LobbyResponse> {
  const response = await fetch(`${SERVER_URL}/lobbies/${lobbyId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow<LobbyResponse>(response);
}

export async function getLobby(lobbyId: string): Promise<LobbyResponse> {
  const response = await fetch(`${SERVER_URL}/lobbies/${lobbyId}`);
  return parseJsonOrThrow<LobbyResponse>(response);
}
