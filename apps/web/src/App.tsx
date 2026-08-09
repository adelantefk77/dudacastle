import { useGameStore } from "./store/gameStore";
import { LandingScreen } from "./screens/LandingScreen";
import { WaitingScreen } from "./screens/WaitingScreen";
import { GameScreen } from "./screens/GameScreen";

export default function App() {
  const phase = useGameStore((s) => s.phase);

  if (phase === "waiting") return <WaitingScreen />;
  if (phase === "playing") return <GameScreen />;
  return <LandingScreen />;
}
