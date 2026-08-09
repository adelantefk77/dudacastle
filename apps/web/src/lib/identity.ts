const STORAGE_KEY = "dudacastle:identity";

export interface Identity {
  userId: string;
  displayName: string;
}

/**
 * Brak systemu kont (zob. TODO w apps/server/src/index.ts) — tożsamość gracza to losowe id
 * trzymane w localStorage, żeby przetrwało odświeżenie strony w tej samej przeglądarce.
 */
export function loadIdentity(): Identity {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      if (parsed.userId && parsed.displayName) return parsed as Identity;
    } catch {
      // ignorowane — nadpisujemy poniżej świeżą tożsamością
    }
  }
  const identity: Identity = { userId: crypto.randomUUID(), displayName: "Gracz" };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function saveDisplayName(displayName: string): Identity {
  const identity = loadIdentity();
  const updated = { ...identity, displayName };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}
