// src/components/WebGALMode.tsx
import { useState } from "react";
import { WebGALParser, type WebGALCommand } from "../utils/webgalParser";
import { open } from "@tauri-apps/plugin-dialog";
import "./WebGALMode.css";

interface WebGALModeProps {
  onClose: () => void;
  onImportTimeline: (gameDir: string, commands: WebGALCommand[]) => void;
}

export default function WebGALMode({ onClose, onImportTimeline }: WebGALModeProps) {
  const [gamePath, setGamePath] = useState<string>("");
  const [script, setScript] = useState<string>("");
  const [parsedCommands, setParsedCommands] = useState<WebGALCommand[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string>("");

  const exampleScript = `changeFigure: 改模/拼好模/大棉袄/大棉袄.jsonl -id=anon -next -motion=taki_smile04 -expression=soyo_smile01;
千早爱音:吼~这样吗？要是你需要的话也不是不行哦？汪汪！ -anon/wjzs2/anon_wjzs2_09.wav -fontSize=default -id -figureId=anon;
changeFigure: sakiko/casual-墨镜/model.json -id=sakiko -next -motion=mana_surprised01 -expression=nyamu_surprised01;
丰川祥子:...你不会有什么奇怪的癖好吧？ -sakiko/wjzs2/sakiko_wjzs2_15.wav -fontSize=default -id -figureId=sakiko;`;

  async function pickGameDir() {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === "string" && dir) {
        setGamePath(dir);
        setError("");
      }
    } catch (e: any) {
      setError(`选择目录失败：${e?.message ?? e}`);
    }
  }

  async function pickFigureFile() {
    try {
      const file = await open({
        multiple: false,
        filters: [{ name: "Live2D/JSON", extensions: ["json", "jsonl"] }],
      });
      if (typeof file === "string" && file) {
        setError("✅ 文件选择成功！请确保上面“游戏目录路径”指向正确的项目根目录。");
      }
    } catch (e: any) {
      setError(`选择文件失败：${e?.message ?? e}`);
    }
  }

  async function parseScriptClick() {
    if (!gamePath.trim()) {
      setError("请先选择或输入游戏目录路径");
      return;
    }
    if (!script.trim()) {
      setError("请输入脚本内容");
      return;
    }
    setIsParsing(true);
    setError("");
    try {
      const parser = new WebGALParser(gamePath);
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
    onImportTimeline(gamePath.trim(), parsedCommands);
    onClose();
  }

  return (
    <div className="webgal-mode">
      <div className="webgal-header">
        <h3>🎮 WebGAL 模式</h3>
        <button className="webgal-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="webgal-section">
        <h4>📁 游戏目录</h4>
        <div className="directory-selector">
          <input
            type="text"
            className="directory-input"
            value={gamePath}
            onChange={(e) => setGamePath(e.target.value)}
            placeholder="选择或输入游戏根目录，如：F:\EASMOUNT_terre\public\games\EASTMOUNT"
          />
          <button className="select-dir-btn" onClick={pickGameDir}>
            选择目录
          </button>
          <button className="select-dir-btn" onClick={pickFigureFile}>
            选择立绘文件
          </button>
        </div>
        <div className="directory-info">
          <small>💡 立绘相对路径会默认从 <code>game/figure/</code> 解析。</small>
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
        <textarea
          className="script-input"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder="输入 WebGAL 脚本..."
          rows={12}
        />
      </div>

      <div className="webgal-section">
        <button className="parse-btn" onClick={parseScriptClick} disabled={!gamePath || !script.trim() || isParsing}>
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
