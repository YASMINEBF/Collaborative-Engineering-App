import React, { useRef } from "react";
import { useCollab } from "../../collabs/provider/CollabProvider";
import { downloadGraphFile, exportGraphToFile, importGraphFileIntoCollabs, parseGraphFile, readFileAsText } from "../../parser/GraphFile";

export default function FileImportExport() {
  const { status, graph } = useCollab();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const canUse = status === "ready" && !!graph;

  const onExport = () => {
    if (!canUse || !graph) return;
    const file = exportGraphToFile(graph);
    downloadGraphFile(file, "graph.json");
  };

  const onImportClick = () => inputRef.current?.click();

  const onImportFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-upload same file
    if (!f || !graph) return;

    const text = await readFileAsText(f);
    const parsed = parseGraphFile(text);

    // simplest behavior: wipe then import
    importGraphFileIntoCollabs(graph, parsed, { wipe: true });
  };

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button disabled={!canUse} onClick={onExport}>Export</button>
      <button disabled={!canUse} onClick={onImportClick}>Import</button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={onImportFile}
      />
    </div>
  );
}
