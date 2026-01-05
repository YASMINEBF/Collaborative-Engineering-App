// src/App.tsx
import "./App.css";

import { CollabProvider } from "./collabs/provider/CollabProvider";
//import CollabStatus from "./collabs/provider/CollabStatus";

import Editor from "./ui/Editor";

function App() {
  return (
    <CollabProvider>
      <div style={{ padding: 12 }}>
        <h2>Engineering Graph</h2>

        <div style={{ marginTop: 12 }}>
          <Editor />
        </div>
      </div>
    </CollabProvider>
  );
}

export default App;
