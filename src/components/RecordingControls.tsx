interface RecordingControlsProps {
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
  recState: "idle" | "rec" | "done";
  recordingTime: number;
  recordingProgress: number;
  blob: Blob | null;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onSaveWebM: () => void;
  onConvertToMov: () => void;
  onTakeScreenshot: () => void;
  onTakePartsScreenshots: () => void;
  onResetToModelBounds: () => void;
  isVp9AlphaSupported: () => boolean;
}

export default function RecordingControls({
  showRecordingBounds,
  setShowRecordingBounds,
  customRecordingBounds,
  setCustomRecordingBounds,
  useModelFrame,
  setUseModelFrame,
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
  onTakeScreenshot,
  onTakePartsScreenshots,
  onResetToModelBounds,
  isVp9AlphaSupported
}: RecordingControlsProps) {
  return (
    <>
      {/* 录制范围设置 */}
      <div className="recording-bounds-settings">
        <input
          type="checkbox"
          id="useModelFrame"
          checked={useModelFrame}
          onChange={(e) => setUseModelFrame(e.target.checked)}
          className="recording-bounds-checkbox"
        />
        <label htmlFor="useModelFrame" className="recording-bounds-label">
          启用模型区域录制
        </label>
      </div>

      <div className="recording-bounds-settings">
        <input
          type="checkbox"
          id="showRecordingBounds"
          checked={showRecordingBounds}
          onChange={(e) => setShowRecordingBounds(e.target.checked)}
          className="recording-bounds-checkbox"
        />
        <label htmlFor="showRecordingBounds" className="recording-bounds-label">
          显示录制区域边框
        </label>
      </div>

      {showRecordingBounds && (
        <>
          <div className="recording-bounds-info">
            录制区域: {customRecordingBounds.width.toFixed(0)} × {customRecordingBounds.height.toFixed(0)} px
            <br />
            位置: ({customRecordingBounds.x.toFixed(0)}, {customRecordingBounds.y.toFixed(0)})
          </div>

          {/* 录制范围调整控件 */}
          <div className="recording-bounds-controls">
            <div className="recording-bounds-controls-title">调整录制范围:</div>
            <div className="recording-bounds-grid">
              <div className="recording-bounds-input-group">
                <label>X:</label>
                <input
                  type="number"
                  value={customRecordingBounds.x}
                  onChange={(e) => setCustomRecordingBounds({ ...customRecordingBounds, x: Number(e.target.value) })}
                  className="recording-bounds-input"
                />
              </div>
              <div className="recording-bounds-input-group">
                <label>Y:</label>
                <input
                  type="number"
                  value={customRecordingBounds.y}
                  onChange={(e) => setCustomRecordingBounds({ ...customRecordingBounds, y: Number(e.target.value) })}
                  className="recording-bounds-input"
                />
              </div>
              <div className="recording-bounds-input-group">
                <label>宽度:</label>
                <input
                  type="number"
                  value={customRecordingBounds.width}
                  onChange={(e) => setCustomRecordingBounds({ ...customRecordingBounds, width: Number(e.target.value) })}
                  className="recording-bounds-input"
                />
              </div>
              <div className="recording-bounds-input-group">
                <label>高度:</label>
                <input
                  type="number"
                  value={customRecordingBounds.height}
                  onChange={(e) => setCustomRecordingBounds({ ...customRecordingBounds, height: Number(e.target.value) })}
                  className="recording-bounds-input"
                />
              </div>
            </div>

            {/* 预设按钮 */}
            <div className="preset-buttons">
              <button
                onClick={() => setCustomRecordingBounds({ x: 0, y: 0, width: 800, height: 600 })}
                className="preset-button"
              >
                800×600
              </button>
              <button
                onClick={() => setCustomRecordingBounds({ x: 0, y: 0, width: 1920, height: 1080 })}
                className="preset-button"
              >
                1920×1080
              </button>
              <button
                onClick={() => setCustomRecordingBounds({ x: 0, y: 0, width: 1280, height: 720 })}
                className="preset-button"
              >
                1280×720
              </button>
            </div>

            {/* 重置为模型边框按钮 */}
            <button
              onClick={onResetToModelBounds}
              className="reset-button"
            >
              重置为模型边框
            </button>
          </div>
        </>
      )}

      {/* 录制质量设置 */}
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

      {recState !== "rec" ? (
        <button
          onClick={onStartRecording}
          disabled={!isVp9AlphaSupported()}
          className="record-button"
        >
          ⬤ 开始录制
        </button>
      ) : (
        <button
          onClick={onStopRecording}
          className="stop-button"
        >
          ■ 停止录制
        </button>
      )}

      {recState === "rec" && (
        <div className="recording-progress">
          <div>录制中... {recordingTime.toFixed(1)}s</div>
          <div className="recording-progress-bar">
            <div 
              className="recording-progress-fill"
              style={{ width: `${recordingProgress}%` }}
            />
          </div>
        </div>
      )}

      <div className="button-grid">
        <button
          onClick={onSaveWebM}
          disabled={!blob}
          className="download-button"
        >
          下载 WebM
        </button>

        <button
          onClick={onConvertToMov}
          disabled={!blob}
          className="convert-button"
        >
          转 MOV
        </button>

        <button
          onClick={onTakeScreenshot}
          className="screenshot-button"
        >
          📸 截图
        </button>

        <button
          onClick={onTakePartsScreenshots}
          className="parts-screenshot-button"
        >
          📦 部件截图
        </button>
      </div>
    </>
  );
} 