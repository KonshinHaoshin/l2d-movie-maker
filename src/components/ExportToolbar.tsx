import RecordingControls from './RecordingControls';

interface ExportToolbarProps {
  showRecordingBounds: boolean;
  setShowRecordingBounds: (show: boolean) => void;
  customRecordingBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  setCustomRecordingBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
  useModelFrame: boolean;
  setUseModelFrame: (use: boolean) => void;
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
  onTakeScreenshot: () => void;
  onTakePartsScreenshots: () => void;
  onResetToModelBounds: () => void;
  isVp9AlphaSupported: () => boolean;
}

export default function ExportToolbar(props: ExportToolbarProps) {
  return (
    <div className="export-toolbar">
      <RecordingControls {...props} />
    </div>
  );
} 
