interface RecordingControlsProps {
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

export default function RecordingControls({
  recordingQuality,
  setRecordingQuality,
  transparentBg,
  setTransparentBg,
  recState,
  recordingTime,
  recordingProgress,
  blob,
  onStartRecording,
  onStopRecording,
  onSaveWebM,
  onConvertToMov,
  onStartOfflineExport,
  onStartSubtitleOnlyExport,
  onStartLive2DOnlyExport,
  onExportSubtitlesSrt,
  onTakeScreenshot,
  onTakePartsScreenshots,
  isVp9AlphaSupported,
}: RecordingControlsProps) {
  const isRecording = recState === "rec";
  const isOfflineExporting = recState === "offline";
  const isBusy = isRecording || isOfflineExporting;

  return (
    <>
      <div className="recording-quality-section">
        <div className="recording-quality-title">录制质量:</div>
        <div className="recording-quality-options">
          <label className="recording-quality-option">
            <input
              type="radio"
              name="quality"
              value="low"
              checked={recordingQuality === "low"}
              onChange={(e) => setRecordingQuality(e.target.value as "low" | "medium" | "high")}
              className="recording-quality-radio"
            />
            低 (24fps)
          </label>
          <label className="recording-quality-option">
            <input
              type="radio"
              name="quality"
              value="medium"
              checked={recordingQuality === "medium"}
              onChange={(e) => setRecordingQuality(e.target.value as "low" | "medium" | "high")}
              className="recording-quality-radio"
            />
            中 (30fps)
          </label>
          <label className="recording-quality-option">
            <input
              type="radio"
              name="quality"
              value="high"
              checked={recordingQuality === "high"}
              onChange={(e) => setRecordingQuality(e.target.value as "low" | "medium" | "high")}
              className="recording-quality-radio"
            />
            高 (60fps)
          </label>
        </div>
      </div>

      <div className="recording-bounds-settings">
        <input
          type="checkbox"
          id="transparentBg"
          checked={transparentBg}
          onChange={(e) => setTransparentBg(e.target.checked)}
          className="transparent-bg-checkbox"
        />
        <label htmlFor="transparentBg" className="transparent-bg-label">
          透明背景
        </label>
      </div>

      {!isRecording ? (
        <button
          onClick={onStartRecording}
          disabled={!isVp9AlphaSupported() || isBusy}
          className="record-button"
        >
          开始录制
        </button>
      ) : (
        <button onClick={onStopRecording} className="stop-button">
          停止录制
        </button>
      )}

      {!isRecording && (
        <div className="button-grid">
          <button
            onClick={onStartOfflineExport}
            disabled={isBusy}
            className="offline-button"
          >
            离线导出全部
          </button>
          <button
            onClick={onStartSubtitleOnlyExport}
            disabled={isBusy}
            className="offline-button"
          >
            导出字幕 WebM
          </button>
          <button
            onClick={onStartLive2DOnlyExport}
            disabled={isBusy}
            className="offline-button"
          >
            导出 Live2D WebM
          </button>
          <button
            onClick={onExportSubtitlesSrt}
            disabled={isBusy}
            className="download-button"
          >
            导出 SRT
          </button>
        </div>
      )}

      {(isRecording || isOfflineExporting) && (
        <div className="recording-progress">
          <div>{isOfflineExporting ? (recordingProgress < 1 ? "准备中..." : "离线导出中...") : "录制中..."} {recordingTime.toFixed(1)}s</div>
          <div className="recording-progress-bar">
            <div className="recording-progress-fill" style={{ width: `${recordingProgress}%` }} />
          </div>
        </div>
      )}

      <div className="button-grid">
        <button onClick={onSaveWebM} disabled={!blob} className="download-button">
          下载 WebM
        </button>
        <button onClick={onConvertToMov} disabled={!blob} className="convert-button">
          转 MOV
        </button>
        <button onClick={onTakeScreenshot} className="screenshot-button">
          截图
        </button>
        <button onClick={onTakePartsScreenshots} className="parts-screenshot-button">
          部件截图
        </button>
      </div>
    </>
  );
}
