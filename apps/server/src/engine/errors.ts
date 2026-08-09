/** Rzucany, gdy akcja gracza łamie zasady gry — łapany na granicy gatewaya i zwracany jako odrzucenie ruchu, nie 500. */
export class GameRuleError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "GameRuleError";
  }
}
