// src/components/WebGALMode.tsx
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

  const exampleScript = `changeFigure: 改模/拼好模/大棉袄/大棉袄.jsonl -id=anon -motion=taki_smile04 -expression=soyo_smile01;
千早爱音:吼~这样吗？要是你需要的话也不是不行哦？汪汪！ -anon/wjzs2/anon_wjzs2_09.wav;`;

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
        setError("未解析到任何有效命令");
        return;
      }
      setParsedCommands(commands);
    } catch (err: any) {
      setError(`解析失败：${err?.message ?? String(err)}`);
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
    <div className="webgal-mode">
      <div className="webgal-header">
        <h3>🎮 WebGAL 模式</h3>
        <div className="webgal-header-actions">
          {onExitWebGALMode && (
            <button className="webgal-exit" onClick={onExitWebGALMode}>
              🚪 退出模式
            </button>
          )}
          <button className="webgal-close" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="webgal-section">
        <h4>📁 文件路径说明</h4>
        <div className="directory-info">
          <small>💡 所有模型文件将从 <code>figure/</code> 文件夹读取<br/>
          • 模型路径：<code>figure/改模/拼好模/大棉袄/大棉袄.jsonl</code><br/>
          • 音频路径：<code>anon/wjzs2/anon_wjzs2_09.wav</code></small>
        </div>
      </div>

      <div className="webgal-section">
        <div className="script-header">
          <h4>📝 WebGAL 脚本</h4>
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
        <div className="script-info">
          <small>💡 <strong>changeFigure命令格式：</strong><br/>
          <code>changeFigure: 路径/到/模型.jsonl -id=角色ID -motion=动作名 -expression=表情名;</code><br/>
          • 支持 .json 和 .jsonl 文件<br/>
          • 路径会从 figure/ 文件夹开始查找<br/>
          • 会自动加载模型并设置动作/表情</small>
        </div>
        <textarea
          className="script-input"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder="输入 WebGAL 脚本..."
          rows={12}
        />
      </div>

      <div className="webgal-section">
        <button className="parse-btn" onClick={parseScriptClick} disabled={!script.trim() || isParsing}>
          {isParsing ? "解析中..." : "🔍 解析脚本"}
        </button>
      </div>

      {error && <div className="webgal-error">❌ {error}</div>}

      {parsedCommands.length > 0 && (
        <div className="webgal-section">
          <h4>✅ 解析结果（{parsedCommands.length} 个命令）</h4>
          <div className="commands-preview">
            {parsedCommands.map((c, i) => (
              <div key={i} className="command-item">
                <div className="command-header">
                  <span className="command-type">{c.type}</span>
                  <span className="command-line">第 {c.lineNumber} 行</span>
                </div>
                <div className="command-content">
                  {c.type === "changeFigure" ? (
                    <div>
                      <strong>角色:</strong> {c.data.id ?? "(未指定)"} <br />
                      <strong>路径:</strong> {c.data.path}
                      {c.data.motion && (
                        <>
                          <br />
                          <strong>动作:</strong> {c.data.motion}
                        </>
                      )}
                      {c.data.expression && (
                        <>
                          <br />
                          <strong>表情:</strong> {c.data.expression}
                        </>
                      )}
                    </div>
                  ) : (
                    <div>
                      <strong>说话者:</strong> {c.data.speaker ?? "(未知)"} <br />
                      <strong>内容:</strong> {c.data.text}
                      {c.data.audioPath && (
                        <>
                          <br />
                          <strong>音频:</strong> {c.data.audioPath}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="webgal-actions">
        <button className="import-btn" onClick={importToTimeline} disabled={parsedCommands.length === 0}>
          📥 导入到时间线
        </button>
        <button className="cancel-btn" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  );
}
