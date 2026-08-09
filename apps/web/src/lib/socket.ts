import { io, type Socket } from "socket.io-client";
import { SERVER_URL } from "./config";

let socket: Socket | null = null;

/** Jeden współdzielony singleton na całą sesję karty przeglądarki — łączy się leniwie przy pierwszym użyciu. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, { autoConnect: true });
  }
  return socket;
}
