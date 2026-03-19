import { useEffect, useMemo, useState } from "react";
import {
  buildWebGALPreviewGroups,
  createWebGALImportPlan,
  detectWebGALAudioRoot,
  extractRoleNameMapFromCommands,
  loadLastWebGALProjectRecord,
  loadWebGALMotionDurations,
  loadWebGALProjectRecord,
  mergeRoleNameMaps,
  resolveFigureAbsolutePath,
  saveWebGALProjectRecord,
  selectWebGALProject,
  summarizeWebGALRoles,
  validateWebGALProject,
  type WebGALImportPlan,
  type WebGALPreviewGroup,
  type WebGALRoleNameMap,
  type WebGALRoleSummary,
} from "../utils/webgalProject";
import { WebGALParser, type WebGALCommand } from "../utils/webgalScript";
import "./WebGALMode.css";

interface WebGALModeProps {
  onClose: () => void;
  onImportTimeline: (plan: WebGALImportPlan) => Promise<void> | void;
  onExitWebGALMode?: () => void;
  defaultMotionDuration: number;
  defaultExpressionDuration: number;
}

const EXAMPLE_SCRIPT = `千早爱音:不用谢哦，毕竟你需要帮助嘛，只要你需要我，我就随时都能来帮助你哦~ -anon/wjzs1/anon_wjzs1_08.wav -fontSize=default -id -figureId=anon;
: 千早爱音此刻非常开心，因为那个需要她的女孩子脸上挂着仿佛能融化积雪的笑容，让她也跟着被融化了。;
changeFigure: MyGO!!!!!/千早爱音/live_default/model.json -id=anon -next -motion=smile01 -expression=smile03;
千早爱音:对了，我叫千早爱音，你呢？ -anon/wjzs1/anon_wjzs1_09.wav -fontSize=default -id -figureId=anon;
changeFigure: sakiko/casual-墨镜/model.json -id=sakiko -next -motion=umiri_thinking01 -expression=rana_thinking01;
丰川祥子:我叫丰川祥子。 -sakiko/wjzs1/sakiko_wjzs1_04.wav -fontSize=default -id -figureId=sakiko;`;

function areMapsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    if (key !== rightKeys[index]) return false;
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function formatSeconds(value: number): string {
  return `${value.toFixed(2)} 秒`;
}

export default function WebGALMode({
  onClose,
  onImportTimeline,
  onExitWebGALMode,
  defaultMotionDuration,
  defaultExpressionDuration,
}: WebGALModeProps) {
  const [script, setScript] = useState("");
  const [parsedCommands, setParsedCommands] = useState<WebGALCommand[]>([]);
  const [roleSummaries, setRoleSummaries] = useState<WebGALRoleSummary[]>([]);
  const [roleNameMap, setRoleNameMap] = useState<WebGALRoleNameMap>({});
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedFigurePath, setSelectedFigurePath] = useState("");
  const [projectRoot, setProjectRoot] = useState("");
  const [figureRoot, setFigureRoot] = useState("");
  const [audioRoot, setAudioRoot] = useState<string | undefined>(undefined);
  const [previewGroups, setPreviewGroups] = useState<WebGALPreviewGroup[]>([]);
  const [motionDurationMap, setMotionDurationMap] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isProjectReady, setIsProjectReady] = useState(false);
  const [hasRestoredProject, setHasRestoredProject] = useState(false);

  const parserStateLabel = error
    ? "解析异常"
    : parsedCommands.length > 0
      ? "可导入"
      : script.trim()
        ? "等待解析"
        : "未输入";

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const lastRecord = await loadLastWebGALProjectRecord();
      if (cancelled || !lastRecord) {
        setHasRestoredProject(true);
        return;
      }

      try {
        const validated = await validateWebGALProject(lastRecord.projectRoot);
        if (cancelled) return;
        setProjectRoot(validated.projectRoot);
        setFigureRoot(validated.figureRoot);
        setAudioRoot(lastRecord.lastAudioRoot);
        setRoleNameMap(lastRecord.roleNameMap ?? {});
        setSelectedRoleId(lastRecord.lastSelectedRoleId ?? "");
        setIsProjectReady(true);
      } catch {
        if (!cancelled) {
          setProjectRoot("");
          setFigureRoot("");
          setAudioRoot(undefined);
        }
      } finally {
        if (!cancelled) {
          setHasRestoredProject(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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

  const commandCounts = useMemo(() => {
    let changeFigureCount = 0;
    let dialogueCount = 0;
    let narrationCount = 0;

    for (const command of parsedCommands) {
      if (command.type === "changeFigure") changeFigureCount += 1;
      if (command.type === "dialogue") dialogueCount += 1;
      if (command.type === "narration") narrationCount += 1;
    }

    return { changeFigureCount, dialogueCount, narrationCount };
  }, [parsedCommands]);

  const selectedRoleSummary = useMemo(
    () => roleSummaries.find((summary) => summary.roleId === selectedRoleId) ?? null,
    [roleSummaries, selectedRoleId],
  );

  const selectedRoleLabel = (selectedRoleSummary?.label ?? selectedRoleId) || "未选择角色";
  const importableGroupCount = previewGroups.filter((group) => !group.skipReason).length;

  const analyzeScript = async (sourceScript: string, sourceRoleNameMap: WebGALRoleNameMap) => {
    if (!sourceScript.trim()) {
      setParsedCommands([]);
      setRoleSummaries([]);
      setPreviewGroups([]);
      setMotionDurationMap({});
      setError("");
      setIsParsing(false);
      return;
    }

    setIsParsing(true);

    try {
      const parser = new WebGALParser();
      const commands = parser.parseScript(sourceScript, { roleNameMap: sourceRoleNameMap });
      if (commands.length === 0) {
        setParsedCommands([]);
        setRoleSummaries([]);
        setPreviewGroups([]);
        setMotionDurationMap({});
        setError("未解析到有效命令");
        return;
      }

      const extractedRoleNames = extractRoleNameMapFromCommands(commands);
      const mergedRoleNameMap = mergeRoleNameMaps(sourceRoleNameMap, extractedRoleNames);

      if (!areMapsEqual(sourceRoleNameMap, mergedRoleNameMap)) {
        setRoleNameMap(mergedRoleNameMap);
        if (projectRoot) {
          await saveWebGALProjectRecord(
            projectRoot,
            {
              roleNameMap: mergedRoleNameMap,
              lastAudioRoot: audioRoot,
              lastSelectedRoleId: selectedRoleId || undefined,
            },
            { setAsLastProject: true },
          );
        }
      }

      const detectedAudioRoot = projectRoot
        ? await detectWebGALAudioRoot(projectRoot, commands, audioRoot)
        : undefined;
      if (detectedAudioRoot !== audioRoot) {
        setAudioRoot(detectedAudioRoot);
        if (projectRoot) {
          await saveWebGALProjectRecord(
            projectRoot,
            {
              roleNameMap: mergedRoleNameMap,
              lastAudioRoot: detectedAudioRoot,
              lastSelectedRoleId: selectedRoleId || undefined,
            },
            { setAsLastProject: true },
          );
        }
      }

      const summaries = summarizeWebGALRoles(commands, mergedRoleNameMap);
      setParsedCommands(commands);
      setRoleSummaries(summaries);
      setError("");

      setSelectedRoleId((current) => {
        if (current && summaries.some((summary) => summary.roleId === current)) {
          return current;
        }
        const preferred = summaries.find((summary) => summary.roleId === current)?.roleId;
        return preferred ?? summaries[0]?.roleId ?? "";
      });
    } catch (err) {
      setParsedCommands([]);
      setRoleSummaries([]);
      setPreviewGroups([]);
      setMotionDurationMap({});
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsParsing(false);
    }
  };

  useEffect(() => {
    if (!hasRestoredProject) return;
    const timeoutId = window.setTimeout(() => {
      void analyzeScript(script, roleNameMap);
    }, 260);

    return () => window.clearTimeout(timeoutId);
  }, [script, roleNameMap, projectRoot, hasRestoredProject]);

  useEffect(() => {
    if (!projectRoot || !selectedRoleId) return;
    void saveWebGALProjectRecord(
      projectRoot,
      {
        roleNameMap,
        lastAudioRoot: audioRoot,
        lastSelectedRoleId: selectedRoleId,
      },
      { setAsLastProject: true },
    );
  }, [projectRoot, selectedRoleId, roleNameMap, audioRoot]);

  useEffect(() => {
    if (!selectedRoleSummary) {
      setSelectedFigurePath("");
      return;
    }

    if (selectedRoleSummary.figurePaths.length === 1) {
      setSelectedFigurePath(selectedRoleSummary.figurePaths[0]);
      return;
    }

    setSelectedFigurePath((current) =>
      selectedRoleSummary.figurePaths.includes(current) ? current : "",
    );
  }, [selectedRoleSummary]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!projectRoot || !selectedFigurePath) {
        setMotionDurationMap({});
        return;
      }

      try {
        const absoluteFigurePath = await resolveFigureAbsolutePath(projectRoot, selectedFigurePath);
        const durations = await loadWebGALMotionDurations(absoluteFigurePath);
        if (!cancelled) {
          setMotionDurationMap(durations);
        }
      } catch {
        if (!cancelled) {
          setMotionDurationMap({});
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectRoot, selectedFigurePath]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!selectedRoleId) {
        setPreviewGroups([]);
        return;
      }

      const groups = await buildWebGALPreviewGroups({
        commands: parsedCommands,
        selectedRoleId,
        selectedFigurePath,
        audioRoot,
        motionDurationMap,
        defaultMotionDuration,
        defaultExpressionDuration,
      });

      if (!cancelled) {
        setPreviewGroups(groups);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    parsedCommands,
    selectedRoleId,
    selectedFigurePath,
    audioRoot,
    motionDurationMap,
    defaultMotionDuration,
    defaultExpressionDuration,
  ]);

  const handleSelectProject = async () => {
    try {
      const pickedProject = await selectWebGALProject();
      if (!pickedProject) return;

      const validated = await validateWebGALProject(pickedProject);
      const projectRecord = await loadWebGALProjectRecord(validated.projectRoot);

      setProjectRoot(validated.projectRoot);
      setFigureRoot(validated.figureRoot);
      setAudioRoot(projectRecord?.lastAudioRoot);
      setRoleNameMap(projectRecord?.roleNameMap ?? {});
      setSelectedRoleId(projectRecord?.lastSelectedRoleId ?? "");
      setSelectedFigurePath("");
      setMotionDurationMap({});
      setIsProjectReady(true);
      setError("");

      await saveWebGALProjectRecord(
        validated.projectRoot,
        {
          roleNameMap: projectRecord?.roleNameMap ?? {},
          lastAudioRoot: projectRecord?.lastAudioRoot,
          lastSelectedRoleId: projectRecord?.lastSelectedRoleId,
        },
        { setAsLastProject: true },
      );
    } catch (err) {
      setIsProjectReady(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClearProject = () => {
    setProjectRoot("");
    setFigureRoot("");
    setAudioRoot(undefined);
    setRoleNameMap({});
    setSelectedRoleId("");
    setSelectedFigurePath("");
    setPreviewGroups([]);
    setMotionDurationMap({});
    setIsProjectReady(false);
  };

  const handleRoleNameChange = async (roleId: string, label: string) => {
    const nextRoleNameMap = mergeRoleNameMaps(roleNameMap, { [roleId]: label });
    setRoleNameMap(nextRoleNameMap);
    if (projectRoot) {
      await saveWebGALProjectRecord(
        projectRoot,
        {
          roleNameMap: nextRoleNameMap,
          lastAudioRoot: audioRoot,
          lastSelectedRoleId: selectedRoleId || undefined,
        },
        { setAsLastProject: true },
      );
    }
  };

  const handleImportTimeline = async () => {
    if (!projectRoot) {
      setError("请先选择 WebGAL 项目目录");
      return;
    }

    if (!selectedRoleId || !selectedRoleSummary) {
      setError("请选择一个脚本角色");
      return;
    }

    if (!selectedFigurePath) {
      setError("请先选择本次导入的立绘路径");
      return;
    }

    const plan = createWebGALImportPlan({
      projectRoot,
      audioRoot,
      selectedRoleId,
      selectedRoleLabel: selectedRoleSummary.label,
      selectedFigurePath,
      previewGroups,
    });

    if (plan.groups.length === 0) {
      setError("当前角色没有可导入的动作/语音组");
      return;
    }

    try {
      setIsImporting(true);
      await onImportTimeline(plan);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImporting(false);
    }
  };

  const projectName = useMemo(() => {
    if (!projectRoot) return "未选择项目";
    const parts = projectRoot.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? projectRoot;
  }, [projectRoot]);

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
            <p className="webgal-subtitle">选择项目后粘贴脚本，自动匹配角色立绘、语音资源和本地映射表，再导入单角色时间线。</p>
          </div>

          <div className="webgal-header-meta">
            <span className={`webgal-chip webgal-chip--state ${error ? "is-error" : parsedCommands.length > 0 ? "is-ready" : ""}`}>
              {parserStateLabel}
            </span>
            <span className="webgal-chip">项目 {isProjectReady ? projectName : "未选择"}</span>
            <span className="webgal-chip">脚本 {scriptLineCount} 行</span>
            <span className="webgal-chip">角色 {roleSummaries.length} 个</span>
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
                <li>选择 WebGAL 项目目录，确认 game/figure 与语音根目录可解析。</li>
                <li>粘贴脚本，自动提取角色、立绘路径、对白和语音。</li>
                <li>检查并修正 figureId 与角色名映射，选择要导入的单个角色。</li>
                <li>确认立绘路径和导入组预览，再把动作、表情、语音一起导入三轨。</li>
              </ol>
            </section>
          </aside>

          <div className="webgal-main">
            <div className="webgal-column">
              <section className="webgal-panel">
                <div className="webgal-panel-header">
                  <div>
                    <div className="webgal-panel-kicker">Project</div>
                    <h4>项目选择</h4>
                  </div>
                  <div className="webgal-toolbar">
                    <button className="webgal-btn webgal-btn--secondary" onClick={handleSelectProject}>
                      选择项目
                    </button>
                    <button className="webgal-btn webgal-btn--ghost" onClick={handleClearProject} disabled={!projectRoot}>
                      清除
                    </button>
                  </div>
                </div>

                <div className="webgal-status-grid">
                  <div className="webgal-info-card">
                    <span>当前项目</span>
                    <strong>{projectName}</strong>
                  </div>
                  <div className="webgal-info-card">
                    <span>Figure 根目录</span>
                    <strong>{figureRoot || "未选择"}</strong>
                  </div>
                  <div className="webgal-info-card">
                    <span>语音根目录</span>
                    <strong>{audioRoot || "待自动探测"}</strong>
                  </div>
                </div>
              </section>

              <section className="webgal-panel webgal-editor-panel">
                <div className="webgal-panel-header">
                  <div>
                    <div className="webgal-panel-kicker">Script</div>
                    <h4>脚本输入</h4>
                  </div>
                  <div className="webgal-toolbar">
                    <button className="webgal-btn webgal-btn--secondary" onClick={() => setScript(EXAMPLE_SCRIPT)}>
                      加载示例
                    </button>
                    <button className="webgal-btn webgal-btn--ghost" onClick={() => setScript("")}>
                      清空文本
                    </button>
                    <button
                      className="webgal-btn webgal-btn--primary"
                      onClick={() => void analyzeScript(script, roleNameMap)}
                      disabled={!script.trim() || isParsing}
                    >
                      {isParsing ? "解析中..." : "立即解析"}
                    </button>
                  </div>
                </div>

                <div className="webgal-editor-meta">
                  <span className="webgal-tag">对白</span>
                  <span className="webgal-tag">改模</span>
                  <span className="webgal-tag">语音</span>
                  <span className="webgal-tag">figureId</span>
                </div>

                <div className="webgal-editor-frame">
                  <textarea
                    className="script-input"
                    value={script}
                    onChange={(event) => setScript(event.target.value)}
                    placeholder="先选择项目，再粘贴 WebGAL 脚本。文本变化后会自动解析，并尝试恢复本地角色映射表。"
                    rows={14}
                  />
                </div>

                <div className="webgal-editor-footer">
                  <div className="webgal-status-copy">
                    <strong>{error ? "存在错误" : parsedCommands.length > 0 ? "解析完成" : "等待输入"}</strong>
                    <span>{error || "当前脚本会自动解析，角色映射和语音根目录也会同步更新。"}</span>
                  </div>
                </div>
              </section>

              <section className="webgal-panel">
                <div className="webgal-panel-header">
                  <div>
                    <div className="webgal-panel-kicker">Mapping</div>
                    <h4>角色映射表</h4>
                  </div>
                  <span className="webgal-panel-note">修改后立即写入本地记录</span>
                </div>

                {roleSummaries.length > 0 ? (
                  <div className="webgal-mapping-list">
                    {roleSummaries.map((summary) => (
                      <div key={summary.roleId} className="webgal-mapping-row">
                        <label className="webgal-mapping-field">
                          <span>figureId</span>
                          <strong>{summary.roleId}</strong>
                        </label>
                        <label className="webgal-mapping-field webgal-mapping-field--grow">
                          <span>角色名</span>
                          <input
                            className="webgal-text-input"
                            value={roleNameMap[summary.roleId] ?? summary.label}
                            onChange={(event) => void handleRoleNameChange(summary.roleId, event.target.value)}
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="webgal-empty">
                    <strong>角色映射表会在解析后出现</strong>
                    <span>脚本里出现的 figureId 和已知说话者会自动合并到本地记录里。</span>
                  </div>
                )}
              </section>
            </div>

            <div className="webgal-column">
              <section className="webgal-panel">
                <div className="webgal-panel-header">
                  <div>
                    <div className="webgal-panel-kicker">Import</div>
                    <h4>导入设置</h4>
                  </div>
                </div>

                <div className="webgal-status-grid">
                  <div className="webgal-info-card">
                    <span>命令总数</span>
                    <strong>{parsedCommands.length}</strong>
                  </div>
                  <div className="webgal-info-card">
                    <span>改模 / 对白 / 旁白</span>
                    <strong>
                      {commandCounts.changeFigureCount} / {commandCounts.dialogueCount} / {commandCounts.narrationCount}
                    </strong>
                  </div>
                  <div className="webgal-info-card">
                    <span>可导入组</span>
                    <strong>{importableGroupCount}</strong>
                  </div>
                </div>

                {roleSummaries.length > 0 ? (
                  <>
                    <div className="webgal-role-list">
                      {roleSummaries.map((summary) => (
                        <button
                          key={summary.roleId}
                          className={`webgal-role-card ${selectedRoleId === summary.roleId ? "is-active" : ""}`}
                          onClick={() => setSelectedRoleId(summary.roleId)}
                          type="button"
                        >
                          <div className="webgal-role-copy">
                            <strong>{summary.label}</strong>
                            <span>{summary.roleId}</span>
                          </div>
                          <div className="webgal-role-stats">
                            <span>改模 {summary.changeFigureCount}</span>
                            <span>对白 {summary.dialogueCount}</span>
                            <span>语音 {summary.voiceCount}</span>
                          </div>
                        </button>
                      ))}
                    </div>

                    <div className="webgal-inline-grid">
                      <label className="webgal-mapping-field webgal-mapping-field--grow">
                        <span>当前角色</span>
                        <strong>{selectedRoleLabel}</strong>
                      </label>
                      <label className="webgal-mapping-field webgal-mapping-field--grow">
                        <span>立绘路径</span>
                        {selectedRoleSummary && selectedRoleSummary.figurePaths.length > 1 ? (
                          <select
                            className="webgal-select"
                            value={selectedFigurePath}
                            onChange={(event) => setSelectedFigurePath(event.target.value)}
                          >
                            <option value="">请选择立绘路径</option>
                            {selectedRoleSummary.figurePaths.map((path) => (
                              <option key={path} value={path}>
                                {path}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <strong>{selectedFigurePath || selectedRoleSummary?.figurePaths[0] || "当前角色没有改模路径"}</strong>
                        )}
                      </label>
                    </div>
                  </>
                ) : (
                  <div className="webgal-empty">
                    <strong>还没有可选角色</strong>
                    <span>先选择项目并粘贴脚本，系统才会生成单角色导入选项。</span>
                  </div>
                )}
              </section>

              <section className="webgal-panel webgal-preview-panel">
                <div className="webgal-panel-header">
                  <div>
                    <div className="webgal-panel-kicker">Preview</div>
                    <h4>导入组预览</h4>
                  </div>
                  <div className="webgal-preview-meta">
                    <span>角色 {selectedRoleLabel}</span>
                    <span>组 {previewGroups.length}</span>
                  </div>
                </div>

                {previewGroups.length > 0 ? (
                  <div className="commands-preview">
                    {previewGroups.map((group) => (
                      <div key={`${group.index}-${group.lineNumber}`} className={`command-item ${group.skipReason ? "is-skipped" : ""}`}>
                        <div className="command-header">
                          <span className={`command-type ${group.skipReason ? "is-warning" : "is-dialogue"}`}>
                            {group.skipReason ? "跳过" : "导入组"}
                          </span>
                          <span className="command-line">
                            第 {group.lineNumber} 行 · 起点 {formatSeconds(group.startSec)}
                          </span>
                        </div>

                        <div className="command-content">
                          <div className="command-row">
                            <span>持续时长</span>
                            <strong>{formatSeconds(group.durationSec)}</strong>
                          </div>
                          <div className="command-row">
                            <span>动作</span>
                            <strong>{group.motion || "无"}</strong>
                          </div>
                          <div className="command-row">
                            <span>表情</span>
                            <strong>{group.expression || "无"}</strong>
                          </div>
                          <div className="command-row">
                            <span>立绘</span>
                            <strong>{group.figurePath || selectedFigurePath || "未指定"}</strong>
                          </div>
                          <div className="command-row">
                            <span>语音</span>
                            <strong>{group.audioRelativePath || "无"}</strong>
                          </div>
                          {group.speaker || group.text ? (
                            <div className="command-block">
                              <span>对白</span>
                              <p>
                                {group.speaker ? `${group.speaker}: ` : ""}
                                {group.text || "无文本"}
                              </p>
                            </div>
                          ) : null}
                          {group.skipReason ? (
                            <div className="command-row">
                              <span>跳过原因</span>
                              <strong>{group.skipReason}</strong>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="webgal-empty">
                    <strong>这里会显示导入组</strong>
                    <span>选择项目并解析脚本后，系统会按当前角色生成动作、表情、语音分组预览。</span>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>

        <div className="webgal-actions">
          <div className="webgal-actions-copy">
            <strong>导入单角色时间线</strong>
            <span>当前会替换现有三轨内容，并把选定立绘加载到预览区。语音优先决定组时长，没有语音时按动作时长回退。</span>
          </div>
          <div className="webgal-actions-buttons">
            <button className="webgal-btn webgal-btn--ghost" onClick={onClose}>
              取消
            </button>
            <button
              className="webgal-btn webgal-btn--primary"
              onClick={() => void handleImportTimeline()}
              disabled={!projectRoot || !selectedRoleId || !selectedFigurePath || importableGroupCount === 0 || isImporting}
            >
              {isImporting ? "导入中..." : "导入时间线"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
