#!/usr/bin/env node
import { WebSocketServer } from "ws";

const PORT = process.env.COLLABS_WS_PORT ? Number(process.env.COLLABS_WS_PORT) : 8080;

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    // Broadcast to all other connected clients
    for (const client of wss.clients) {
      if (client !== ws && client.readyState === 1) {
        client.send(data);
      }
    }
  });

  ws.on("close", () => {
    // noop
  });
});

console.log(`Collabs WebSocket relay listening on ws://localhost:${PORT}`);
