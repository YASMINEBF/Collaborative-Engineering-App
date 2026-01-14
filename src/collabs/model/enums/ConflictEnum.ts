export enum ConflictKind {
  DuplicateName = "duplicateName",
  InvalidFeedCardinality = "invalidFeedCardinality",
  DanglingReference = "danglingReference",
  CycleDetected = "cycleDetected",
  FeedMediumMismatch = "feedMediumMismatch",
}

export default {
  ConflictKind,
};
