import { KINGDOMS } from "@dudacastle/shared";
import { useGameStore } from "../store/gameStore";
import "./landing-screen.css";

function kingdomName(kingdomId: string): string {
  return KINGDOMS.find((k) => k.id === kingdomId)?.name ?? kingdomId;
}

export function WaitingScreen() {
  const { lobby, resetToLanding } = useGameStore();
  if (!lobby) return null;

  return (
    <main className="landing">
      <div className="landing__content">
        <h1 className="landing__title">Oczekiwanie na graczy</h1>
        <p className="landing__subtitle">
          Kod meczu do wysłania znajomym: <strong>{lobby.lobbyId}</strong>
        </p>

        <section className="landing__panel">
          <h2>
            Gracze ({lobby.seats.length}/{lobby.maxPlayers})
          </h2>
          <ul>
            {lobby.seats.map((seat) => (
              <li key={seat.matchPlayerId}>
                {seat.isBot && "🤖 "}
                {seat.displayName} — {kingdomName(seat.kingdomId)}
              </li>
            ))}
          </ul>
          <p>Mecz wystartuje automatycznie, gdy dołączy komplet graczy.</p>
        </section>

        <button type="button" className="landing__cta" onClick={resetToLanding}>
          Anuluj
        </button>
      </div>
    </main>
  );
}
