#!/usr/bin/env node
import fs from 'fs';

const N = Number(process.argv[2] || 1000);
const avgDeg = Number(process.argv[3] || 1);
const out = process.argv[4] || `graph-${N}.json`;

const Mediums = ["Water", "Oil", "Steam", "Air"];

const nodes = [];
const edges = [];

for (let i = 0; i < N; i++) {
  nodes.push({
    id: `c${i}`,
    type: Math.random() < 0.8 ? 'equipment' : 'port',
    name: `node-${i}`,
    position: { x: Math.round(Math.random() * 2000), y: Math.round(Math.random() * 2000) },
    attrs: { description: `auto-generated ${i}` },
  });
}

let edgeId = 0;
for (let i = 0; i < N; i++) {
  const deg = Math.max(0, Math.round((Math.random() * 2 - 1) + avgDeg));
  for (let k = 0; k < deg; k++) {
    const j = Math.floor(Math.random() * N);
    if (j === i) continue;
    edges.push({ id: `e${edgeId++}`, kind: 'feeds', source: `c${i}`, target: `c${j}`, medium: null });
  }
}

const outObj = { version: 1, meta: { generatedAt: Date.now() }, nodes, edges };
fs.writeFileSync(out, JSON.stringify(outObj, null, 2), 'utf8');
console.log('wrote', out);
