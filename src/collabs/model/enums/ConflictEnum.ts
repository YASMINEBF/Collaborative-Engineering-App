export enum ConflictKind {
  DuplicateName = "duplicateName",
  InvalidFeedCardinality = "invalidFeedCardinality",
  DanglingReference = "danglingReference",
  CycleDetected = "cycleDetected",
  FeedMediumMismatch = "feedMediumMismatch",
  SemanticallyRelatedAttributes = "semanticallyRelatedAttributes",
}

export default {
  ConflictKind,
};
