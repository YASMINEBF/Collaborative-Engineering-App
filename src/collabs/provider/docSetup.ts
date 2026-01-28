// docSetup.ts
import { CRuntime } from "@collabs/collabs";
import { WebSocketNetwork } from "@collabs/ws-client";
import CEngineeringGraph from "../model/CEngineeringGraph";

export async function createLocalDoc(): Promise<{
  doc: CRuntime;
  graph: CEngineeringGraph;
  network: WebSocketNetwork;
}> {
  const doc = new CRuntime();
  const graph = doc.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));

  const url =
    (typeof window !== "undefined" && (window as any).COLLABS_WS_URL) ||
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_COLLABS_WS_URL) ||
    (typeof process !== "undefined" ? (process as any).COLLABS_WS_URL : undefined) ||
    "ws://localhost:3001";

  const network = new WebSocketNetwork(url);
  // Use the same doc ID used when registering the root collab (`engineeringGraph`).
  network.subscribe(doc, "engineeringGraph"); // docID/room

  network.on("Connect", () => console.log("Collabs WS connected:", url));
  network.on("Disconnect", (e) => console.log("Collabs WS disconnected:", e));

  // Some versions connect automatically; if yours doesn’t, call:
  network.connect?.();

  return { doc, graph, network };
}
