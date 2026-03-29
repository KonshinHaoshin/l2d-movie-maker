export type Clip = {
  id: string;
  name: string;
  start: number;
  duration: number;
  audioUrl?: string;
  audioPath?: string;
  audioSourceDuration?: number;
  waveformPeaks?: number[];
  audioBuffer?: AudioBuffer;
};

export type SubtitleClip = Clip & {
  subtitleText: string;
  speakerName?: string;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  linkedAudioClipId?: string;
};

export type TrackKind = "motion" | "expr" | "audio" | "subtitle";
