export enum ConflictKind {
  DuplicateName = "duplicateName",
  InvalidFeedCardinality = "invalidFeedCardinality",
  DanglingReference = "danglingReference",
  CycleDetected = "cycleDetected",
}

export default {
  ConflictKind,
};
