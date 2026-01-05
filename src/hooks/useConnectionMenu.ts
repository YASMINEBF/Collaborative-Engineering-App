import { useCallback, useState } from "react";
import type { Connection } from "reactflow";
import type { RelationshipKind } from "../models/relationships/enums/RelationshipTypes";

type PendingConn = {
  conn: Connection; // has source/target
  menuPos: { x: number; y: number }; // screen coords inside wrapper
};

export function useConnectionMenu() {
  const [pending, setPending] = useState<PendingConn | null>(null);

  const open = useCallback((conn: Connection, menuPos: { x: number; y: number }) => {
    setPending({ conn, menuPos });
  }, []);

  const close = useCallback(() => setPending(null), []);

  const choose = useCallback(
    (kind: RelationshipKind | "") => {
      const snapshot = pending;
      setPending(null);
      return { kind, pending: snapshot };
    },
    [pending]
  );

  return { pending, open, close, choose };
}
