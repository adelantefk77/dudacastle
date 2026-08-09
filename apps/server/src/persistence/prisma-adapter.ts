import { PrismaClient } from "@prisma/client";
import type { GameEvent, GameState } from "@dudacastle/shared";
import type { SeatConfig } from "../engine/match-manager.js";
import type { PersistenceAdapter } from "./adapter.js";

export class PrismaPersistenceAdapter implements PersistenceAdapter {
  constructor(private readonly prisma: PrismaClient) {}

  async createMatch(matchId: string, seats: SeatConfig[]): Promise<void> {
    await this.prisma.match.create({
      data: {
        id: matchId,
        status: "IN_PROGRESS",
        playerCount: seats.length,
        startedAt: new Date(),
        players: {
          create: seats.map((seat, index) => ({
            id: seat.matchPlayerId,
            userId: seat.userId,
            kingdomId: seat.kingdomId,
            seatOrder: index,
          })),
        },
      },
    });
  }

  async recordEvents(matchId: string, events: GameEvent[]): Promise<void> {
    if (events.length === 0) return;
    // Idempotentne wobec ewentualnych powtórzeń (np. retry po timeoutcie sieciowym) dzięki
    // unique([matchId, sequenceNo]) — duplikat jest po prostu pomijany.
    await this.prisma.matchEvent.createMany({
      data: events.map((event) => ({
        matchId,
        sequenceNo: event.sequenceNo,
        actorMatchPlayerId: event.actorMatchPlayerId,
        type: event.type,
        payload: event.payload as object,
      })),
      skipDuplicates: true,
    });
  }

  async saveSnapshot(matchId: string, sequenceNo: number, state: GameState): Promise<void> {
    await this.prisma.matchSnapshot.upsert({
      where: { matchId_sequenceNo: { matchId, sequenceNo } },
      create: { matchId, sequenceNo, state: state as unknown as object },
      update: { state: state as unknown as object },
    });
  }

  async finalizeMatch(matchId: string, winnerMatchPlayerId: string | null): Promise<void> {
    await this.prisma.match.update({
      where: { id: matchId },
      data: { status: "FINISHED", endedAt: new Date(), winnerMatchPlayerId },
    });
  }
}
