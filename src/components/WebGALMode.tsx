import { useState } from "react";
import { WebGALParser, type WebGALCommand } from "../utils/webgalParser";
import "./WebGALMode.css";

interface WebGALModeProps {
  onClose: () => void;
  onImportTimeline: (commands: WebGALCommand[]) => void;
  onExitWebGALMode?: () => void;
}

export default function WebGALMode({ onClose, onImportTimeline, onExitWebGALMode }: WebGALModeProps) {
  const [script, setScript] = useState<string>("");
  const [parsedCommands, setParsedCommands] = useState<WebGALCommand[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string>("");

  const exampleScript = `changeFigure: 改模/拼好模/大概被/大概被.jsonl -id=anon -motion=taki_smile04 -expression=soyo_smile01;
千早爱音:呐，这样吗？要是你需要的话也不是不行呀？汪汪;-anon/wjzs2/anon_wjzs2_09.wav;`;

  async function parseScriptClick() {
    if (!script.trim()) {
      setError("请输入脚本内容");
      return;
    }
    setIsParsing(true);
    setError("");
    try {
      const parser = new WebGALParser();
      const commands = parser.parseScript(script);
      if (commands.length === 0) {
        setError("未解析到有效命令");
        return;
      }
      setParsedCommands(commands);
    } catch (err: any) {
      setError(`解析失败: ${err?.message ?? String(err)}`);
    } finally {
      setIsParsing(false);
    }
  }

  function importToTimeline() {
    if (parsedCommands.length === 0) {
      setError("没有可导入的命令");
      return;
    }
    onImportTimeline(parsedCommands);
    onClose();
  }

  return (
    <div className="webgal-mode" onClick={onClose}>
      <div className="webgal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="webgal-header">
          <div>
            <h3>WebGAL 模式</h3>
            <p className="webgal-subtitle">粘贴脚本 | 解析预览 | 导入时间线</p>
          </div>
          <div className="webgal-header-actions">
            {onExitWebGALMode && (
              <button className="webgal-exit" onClick={onExitWebGALMode}>
                退出模式
              </button>
            )}
            <button className="webgal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <div className="webgal-grid">
          <div className="webgal-section webgal-tips">
            <h4>路径规则</h4>
            <ul>
              <li>模型路径从 <code>figure/</code> 开始解析</li>
              <li>支持 <code>.json</code> 和 <code>.jsonl</code></li>
              <li>音频可写相对路径，例如 <code>anon/wjzs2/anon_wjzs2_09.wav</code></li>
            </ul>
            <div className="script-info">
              <strong>changeFigure 示例:</strong>
              <code>changeFigure: 路径/模型.jsonl -id=角色ID -motion=动作 -expression=表情</code>
            </div>
          </div>

          <div className="webgal-section webgal-editor">
            <div className="script-header">
              <h4>脚本输入</h4>
              <div className="script-actions">
                <button className="example-btn" onClick={() => setScript(exampleScript)}>
                  加载示例
                </button>
                <button
                  className="clear-btn"
                  onClick={() => {
                    setScript("");
                    setParsedCommands([]);
                    setError("");
                  }}
                >
                  清空
                </button>
              </div>
            </div>

            <textarea
              className="script-input"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="输入 WebGAL 脚本..."
              rows={10}
            />

            <button className="parse-btn" onClick={parseScriptClick} disabled={!script.trim() || isParsing}>
              {isParsing ? "解析中..." : "解析脚本"}
            </button>

            {error && <div className="webgal-error">{error}</div>}
          </div>
        </div>

        {parsedCommands.length > 0 && (
          <div className="webgal-section webgal-results">
            <div className="results-title">解析结果 ({parsedCommands.length})</div>
            <div className="commands-preview">
              {parsedCommands.map((c, i) => (
                <div key={i} className="command-item">
                  <div className="command-header">
                    <span className="command-type">{c.type}</span>
                    <span className="command-line">行 {c.lineNumber}</span>
                  </div>
                  <div className="command-content">
                    {c.type === "changeFigure" ? (
                      <>
                        <div><strong>角色:</strong> {c.data.id ?? "(未指定)"}</div>
                        <div><strong>路径:</strong> {c.data.path}</div>
                        {c.data.motion && <div><strong>动作:</strong> {c.data.motion}</div>}
                        {c.data.expression && <div><strong>表情:</strong> {c.data.expression}</div>}
                      </>
                    ) : (
                      <>
                        <div><strong>说话者:</strong> {c.data.speaker ?? "(未知)"}</div>
                        <div><strong>内容:</strong> {c.data.text}</div>
                        {c.data.audioPath && <div><strong>音频:</strong> {c.data.audioPath}</div>}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="webgal-actions">
          <button className="import-btn" onClick={importToTimeline} disabled={parsedCommands.length === 0}>
            导入到时间线
          </button>
          <button className="cancel-btn" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
