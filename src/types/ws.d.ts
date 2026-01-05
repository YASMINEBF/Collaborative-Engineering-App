declare module "ws" {
  import { Server as _Server } from "net";
  export class WebSocketServer extends _Server {
    constructor(options?: any);
    on(event: string, listener: (...args: any[]) => void): this;
    close(cb?: () => void): void;
    clients: Set<any>;
  }
  export class WebSocket {
    send(data: any): void;
    close(): void;
    readyState: number;
    static OPEN: number;
  }
  export default WebSocket;
}
