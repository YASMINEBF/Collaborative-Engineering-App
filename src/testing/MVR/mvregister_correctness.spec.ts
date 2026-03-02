import { test, expect } from "@playwright/test";
import { CRuntime } from "@collabs/collabs";
import CEngineeringGraph from "../../collabs/model/CEngineeringGraph";

const RUNS = 200;

test("CValueMap MV-register: concurrent writes converge correctly (200 runs)", async () => {
  for (let i = 0; i < RUNS; i++) {
    const docA = new CRuntime();
    const graphA = docA.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));

    const docB = new CRuntime();
    const graphB = docB.registerCollab("engineeringGraph", (init) => new CEngineeringGraph(init));

    const compId = "c0";
    const KEY = "attr:testKey";

    graphA.components.set(compId, "equipment", "TestComp");
    await new Promise(r => setTimeout(r, 0));

    const savedState = docA.save();
    docB.load(savedState);

    const compA: any = graphA.components.get(compId);
    const compB: any = graphB.components.get(compId);

    const v1 = { value: "A", run: i };
    const v2 = { value: "B", run: i };

    compA.attrs.set(KEY, v1);
    await new Promise(r => setTimeout(r, 0));

    compB.attrs.set(KEY, v2);
    await new Promise(r => setTimeout(r, 0));

    const stateA = docA.save();
    const stateB = docB.save();

    await new Promise(r => setTimeout(r, 0));

    docA.load(stateB);
    docB.load(stateA);

    await new Promise(r => setTimeout(r, 0));

    const candidatesA = compA.attrs.getConflicts(KEY);
    const candidatesB = compB.attrs.getConflicts(KEY);

    // Both replicas must see exactly 2 candidates
    expect(candidatesA.length).toBe(2);
    expect(candidatesB.length).toBe(2);

    // Both replicas must see the same candidates (convergence)
    expect(JSON.stringify(candidatesA.sort((a: any, b: any) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))
    ))).toBe(JSON.stringify(candidatesB.sort((a: any, b: any) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))
    )));
  }
});