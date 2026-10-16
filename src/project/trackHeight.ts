// How tall a track's row in the arrangement can be (unfolded): saved with
// the project, drawn by the arrangement (studio/timeline/layout.ts).

/** The standard height: room for all four rows of a track's header. */
export const DEFAULT_TRACK_HEIGHT = 118;
export const MIN_TRACK_HEIGHT = 40;
export const MAX_TRACK_HEIGHT = 320;

export const clampTrackHeight = (height: number) => Math.round(Math.min(MAX_TRACK_HEIGHT, Math.max(MIN_TRACK_HEIGHT, height)));
