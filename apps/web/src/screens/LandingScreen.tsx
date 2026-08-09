import { useState } from "react";
import { KingdomPicker } from "../components/KingdomPicker";
import { useGameStore } from "../store/gameStore";
import "./landing-screen.css";

export function LandingScreen() {
  const { displayName, setDisplayName, createNewLobby, joinExistingLobby, connecting, lastError, dismissError } = useGameStore();
  const [createKingdomId, setCreateKingdomId] = useState<string | null>(null);
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [fillWithBots, setFillWithBots] = useState(false);
  const [joinLobbyId, setJoinLobbyId] = useState("");
  const [joinKingdomId, setJoinKingdomId] = useState<string | null>(null);

  return (
    <main className="landing">
      <div className="landing__content">
        <h1 className="landing__title">DudaCastle</h1>
        <p className="landing__subtitle">Cyfrowa adaptacja gry karciano-planszowej — zniszcz Królestwa przeciwników.</p>

        {lastError && (
          <div className="landing__error" onClick={dismissError} role="alert">
            {lastError} (kliknij, aby ukryć)
          </div>
        )}

        <label className="landing__field">
          Twoja nazwa
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            placeholder="Gracz"
          />
        </label>

        <section className="landing__panel">
          <h2>Stwórz nowy mecz</h2>
          <label className="landing__field">
            Liczba graczy
            <select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))}>
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <p>Wybierz swoje królestwo:</p>
          <KingdomPicker value={createKingdomId} onChange={setCreateKingdomId} />
          <label className="landing__checkbox">
            <input type="checkbox" checked={fillWithBots} onChange={(e) => setFillWithBots(e.target.checked)} />
            Wypełnij pozostałe miejsca botami (gra rusza od razu)
          </label>
          <button
            type="button"
            className="landing__cta"
            disabled={!createKingdomId || connecting}
            onClick={() => createKingdomId && createNewLobby(createKingdomId, maxPlayers, fillWithBots)}
          >
            {fillWithBots ? "Zagraj z botami" : "Stwórz mecz"}
          </button>
        </section>

        <section className="landing__panel">
          <h2>Dołącz do meczu</h2>
          <label className="landing__field">
            Kod meczu
            <input
              type="text"
              value={joinLobbyId}
              onChange={(e) => setJoinLobbyId(e.target.value.trim())}
              placeholder="np. jdW0nNrz8H"
            />
          </label>
          <p>Wybierz swoje królestwo:</p>
          <KingdomPicker value={joinKingdomId} onChange={setJoinKingdomId} />
          <button
            type="button"
            className="landing__cta"
            disabled={!joinKingdomId || !joinLobbyId || connecting}
            onClick={() => joinKingdomId && joinExistingLobby(joinLobbyId, joinKingdomId)}
          >
            Dołącz
          </button>
        </section>
      </div>
    </main>
  );
}
