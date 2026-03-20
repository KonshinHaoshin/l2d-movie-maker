import RecordingControls from './RecordingControls';

interface ExportToolbarProps {
  recordingQuality: "low" | "medium" | "high";
  setRecordingQuality: (quality: "low" | "medium" | "high") => void;
  transparentBg: boolean;
  setTransparentBg: (transparent: boolean) => void;
  recState: "idle" | "rec" | "done" | "offline";
  recordingTime: number;
  recordingProgress: number;
  blob: Blob | null;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onSaveWebM: () => void;
  onConvertToMov: () => void;
  onStartOfflineExport: () => void;
  onStartSubtitleOnlyExport: () => void;
  onStartLive2DOnlyExport: () => void;
  onExportSubtitlesSrt: () => void;
  onTakeScreenshot: () => void;
  onTakePartsScreenshots: () => void;
  isVp9AlphaSupported: () => boolean;
}

export default function ExportToolbar(props: ExportToolbarProps) {
  return (
    <div className="export-toolbar">
      <RecordingControls {...props} />
    </div>
  );
}
