export enum ConflictKind {
  DuplicateName = "duplicateName",
  InvalidFeedCardinality = "invalidFeedCardinality",
  DanglingReference = "danglingReference",
  CycleDetected = "cycleDetected",
  FeedMediumMismatch = "feedMediumMismatch",
  SemanticallyRelatedAttributes = "semanticallyRelatedAttributes",
  ConcurrentAttributeEdit = "concurrentAttributeEdit",
}

export default {
  ConflictKind,
};
