import { useEffect, useMemo, useState } from "react";
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
        setParsedCommands([]);
        return;
      }

      setParsedCommands(commands);
    } catch (err: any) {
      setParsedCommands([]);
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const scriptLineCount = useMemo(() => {
    const trimmed = script.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\r?\n/).filter(Boolean).length;
  }, [script]);

  const changeFigureCount = useMemo(
    () => parsedCommands.filter((command) => command.type === "changeFigure").length,
    [parsedCommands],
  );
  const dialogueCount = parsedCommands.length - changeFigureCount;
  const canImport = parsedCommands.length > 0;
  const parserStateLabel = error
    ? "解析异常"
    : canImport
      ? "可导入"
      : script.trim()
        ? "等待解析"
        : "未输入";

  return (
    <div className="webgal-mode" onClick={onClose}>
      <div
        className="webgal-modal"
        role="dialog"
        aria-modal="true"
        aria-label="WebGAL 导入工作台"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="webgal-header">
          <div className="webgal-heading">
            <div className="webgal-kicker">Script Import Workbench</div>
            <h3>WebGAL 导入工作台</h3>
            <p className="webgal-subtitle">把脚本解析成可检查的镜头指令，再导入主时间线继续剪辑。</p>
          </div>

          <div className="webgal-header-meta">
            <span className={`webgal-chip webgal-chip--state ${error ? "is-error" : canImport ? "is-ready" : ""}`}>
              {parserStateLabel}
            </span>
            <span className="webgal-chip">脚本 {scriptLineCount} 行</span>
            <span className="webgal-chip">命令 {parsedCommands.length} 条</span>
          </div>

          <div className="webgal-header-actions">
            {onExitWebGALMode ? (
              <button className="webgal-btn webgal-btn--warn" onClick={onExitWebGALMode}>
                退出模式
              </button>
            ) : null}
            <button className="webgal-icon-btn" onClick={onClose} aria-label="关闭 WebGAL 导入工作台">
              ×
            </button>
          </div>
        </div>

        <div className="webgal-workbench">
          <aside className="webgal-sidebar">
            <section className="webgal-panel">
              <div className="webgal-panel-header">
                <div>
                  <div className="webgal-panel-kicker">Workflow</div>
                  <h4>导入流程</h4>
                </div>
              </div>
              <ol className="webgal-steps">
                <li>粘贴 WebGAL 脚本，或先载入示例核对格式。</li>
                <li>执行解析，确认角色、改模、对白与音频路径都正确。</li>
                <li>导入时间线，然后回到主工作区继续编排。</li>
              </ol>
            </section>

            <section className="webgal-panel">
              <div className="webgal-panel-header">
                <div>
                  <div className="webgal-panel-kicker">Syntax</div>
                  <h4>路径与字段</h4>
                </div>
              </div>
              <div className="webgal-rule-list">
                <div className="webgal-rule-item">
                  <span>模型路径</span>
                  <strong>从 `figure/` 规则解析 `.json` / `.jsonl`</strong>
                </div>
                <div className="webgal-rule-item">
                  <span>音频路径</span>
                  <strong>支持相对路径，例如 `anon/wjzs2/anon_wjzs2_09.wav`</strong>
                </div>
                <div className="webgal-rule-item">
                  <span>改模语法</span>
                  <strong>`changeFigure: 路径 -id=角色ID -motion=动作 -expression=表情`</strong>
                </div>
              </div>
            </section>

            <section className="webgal-panel">
              <div className="webgal-panel-header">
                <div>
                  <div className="webgal-panel-kicker">Summary</div>
                  <h4>解析概览</h4>
                </div>
              </div>
              <div className="webgal-stats">
                <div className="webgal-stat-card">
                  <span>改模命令</span>
                  <strong>{changeFigureCount}</strong>
                </div>
                <div className="webgal-stat-card">
                  <span>对白命令</span>
                  <strong>{dialogueCount}</strong>
                </div>
                <div className="webgal-stat-card">
                  <span>当前状态</span>
                  <strong>{parserStateLabel}</strong>
                </div>
              </div>
            </section>
          </aside>

          <div className="webgal-main">
            <section className="webgal-panel webgal-editor-panel">
              <div className="webgal-panel-header">
                <div>
                  <div className="webgal-panel-kicker">Editor</div>
                  <h4>脚本输入</h4>
                </div>
                <div className="webgal-toolbar">
                  <button className="webgal-btn webgal-btn--secondary" onClick={() => setScript(exampleScript)}>
                    加载示例
                  </button>
                  <button
                    className="webgal-btn webgal-btn--ghost"
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

              <div className="webgal-editor-meta">
                <span className="webgal-tag">对白</span>
                <span className="webgal-tag">改模</span>
                <span className="webgal-tag">音频路径</span>
              </div>

              <div className="webgal-editor-frame">
                <textarea
                  className="script-input"
                  value={script}
                  onChange={(event) => setScript(event.target.value)}
                  placeholder="在这里粘贴 WebGAL 脚本。建议一次导入一个完整段落，方便核对角色、动作、表情与音频。"
                  rows={14}
                />
              </div>

              <div className="webgal-editor-footer">
                <div className="webgal-status-copy">
                  <strong>{error ? "存在错误" : canImport ? "解析完成" : "等待输入"}</strong>
                  <span>{error || "解析成功后，右侧会生成可以逐条检查的命令列表。"}</span>
                </div>
                <button className="webgal-btn webgal-btn--primary" onClick={parseScriptClick} disabled={!script.trim() || isParsing}>
                  {isParsing ? "解析中..." : "解析脚本"}
                </button>
              </div>
            </section>

            <section className="webgal-panel webgal-preview-panel">
              <div className="webgal-panel-header">
                <div>
                  <div className="webgal-panel-kicker">Preview</div>
                  <h4>命令预览</h4>
                </div>
                <div className="webgal-preview-meta">
                  <span>共 {parsedCommands.length} 条</span>
                  <span>改模 {changeFigureCount}</span>
                  <span>对白 {dialogueCount}</span>
                </div>
              </div>

              {canImport ? (
                <div className="commands-preview">
                  {parsedCommands.map((command, index) => (
                    <div key={`${command.type}-${command.lineNumber}-${index}`} className="command-item">
                      <div className="command-header">
                        <span className={`command-type ${command.type === "changeFigure" ? "is-figure" : "is-dialogue"}`}>
                          {command.type === "changeFigure" ? "改模" : "对白"}
                        </span>
                        <span className="command-line">第 {command.lineNumber} 行</span>
                      </div>

                      <div className="command-content">
                        {command.type === "changeFigure" ? (
                          <>
                            <div className="command-row">
                              <span>角色</span>
                              <strong>{command.data.id ?? "未指定"}</strong>
                            </div>
                            <div className="command-row">
                              <span>模型路径</span>
                              <strong>{command.data.path}</strong>
                            </div>
                            {command.data.motion ? (
                              <div className="command-row">
                                <span>动作</span>
                                <strong>{command.data.motion}</strong>
                              </div>
                            ) : null}
                            {command.data.expression ? (
                              <div className="command-row">
                                <span>表情</span>
                                <strong>{command.data.expression}</strong>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <div className="command-row">
                              <span>说话者</span>
                              <strong>{command.data.speaker ?? "未知"}</strong>
                            </div>
                            <div className="command-block">
                              <span>文本</span>
                              <p>{command.data.text}</p>
                            </div>
                            {command.data.audioPath ? (
                              <div className="command-row">
                                <span>音频</span>
                                <strong>{command.data.audioPath}</strong>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="webgal-empty">
                  <strong>这里会显示解析结果</strong>
                  <span>先输入脚本并执行解析，再检查角色、模型路径、动作、表情和对白内容。</span>
                </div>
              )}
            </section>
          </div>
        </div>

        <div className="webgal-actions">
          <div className="webgal-actions-copy">
            <strong>导入到时间线</strong>
            <span>确认右侧列表无误后再执行导入，当前主工作区状态不会被这个窗口清空。</span>
          </div>
          <div className="webgal-actions-buttons">
            <button className="webgal-btn webgal-btn--ghost" onClick={onClose}>
              取消
            </button>
            <button className="webgal-btn webgal-btn--primary" onClick={importToTimeline} disabled={!canImport}>
              导入时间线
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
