// components/disc-actions/types.ts
export type Disc = {
  id: string;
  name: string;
  type: string;
};

export type DistanceUnit = 'feet' | 'meters';

export type DiscActionsConfig = {
  showStopwatch?: boolean;
  showThrowAnalysis?: boolean;
  allowSaveThrows?: boolean;
  distanceUnit?: DistanceUnit; // ← new: user preference
};