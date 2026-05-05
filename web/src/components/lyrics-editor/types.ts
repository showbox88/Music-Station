/**
 * Shared types for the LyricsEditor stages. The wrapper component owns
 * `lines` state and passes it through PickStage → PasteStage → TagStage,
 * so the type lives here rather than inside any one stage.
 */

export interface TaggedLine {
  text: string;
  /** ms from start of audio. -1 = not yet tagged. */
  ms: number;
}
