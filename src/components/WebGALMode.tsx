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

function stringifyRoleNameMap(roleNameMap: WebGALRoleNameMap): string {
  return JSON.stringify(roleNameMap, null, 2);
}

function parseRoleNameMapEditor(value: string): WebGALRoleNameMap {
  const trimmed = value.trim();
  if (!trimmed) return {};

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("角色映射表必须是 JSON 对象");
  }

  const next: WebGALRoleNameMap = {};
  for (const [key, rawValue] of Object.entries(parsed)) {
    const roleId = key.trim();
    const roleName = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!roleId || !roleName) continue;
    next[roleId] = roleName;
  }
  return next;
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
  const [showRoleMappings, setShowRoleMappings] = useState(false);
  const [roleMappingEditorText, setRoleMappingEditorText] = useState("{}");
  const [roleMappingEditorError, setRoleMappingEditorError] = useState("");
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [extendClipToSpokenSpan, setExtendClipToSpokenSpan] = useState(true);

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
    if (showRoleMappings) {
      setRoleMappingEditorText(stringifyRoleNameMap(roleNameMap));
      setRoleMappingEditorError("");
    }
  }, [showRoleMappings, roleNameMap]);

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
        projectRoot,
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

  const handleRoleNameMapCommit = async (nextRoleNameMap: WebGALRoleNameMap) => {
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

  const handleRoleMappingEditorChange = async (nextText: string) => {
    setRoleMappingEditorText(nextText);

    try {
      const nextRoleNameMap = parseRoleNameMapEditor(nextText);
      setRoleMappingEditorError("");
      if (!areMapsEqual(roleNameMap, nextRoleNameMap)) {
        await handleRoleNameMapCommit(nextRoleNameMap);
      }
    } catch (error) {
      setRoleMappingEditorError(error instanceof Error ? error.message : String(error));
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
      includeSubtitles,
      extendClipToSpokenSpan,
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
            <section className="webgal-panel webgal-editor-panel webgal-editor-panel--main">
              <div className="webgal-panel-header">
                <div>
                  <div className="webgal-panel-kicker">Script</div>
                  <h4>脚本输入</h4>
                </div>
                <div className="webgal-toolbar">
                  <button className="webgal-btn webgal-btn--secondary" onClick={handleSelectProject}>
                    选择项目
                  </button>
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

              <div className="webgal-project-strip">
                <span className="webgal-project-meta">项目：{isProjectReady ? projectName : "未选择"}</span>
                <span className="webgal-project-meta">Figure：{figureRoot || "未选择"}</span>
                <span className="webgal-project-meta">语音：{audioRoot || "待自动探测"}</span>
                <button className="webgal-project-link" onClick={handleClearProject} disabled={!projectRoot} type="button">
                  清除项目
                </button>
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

            </section>

            <div className="webgal-column webgal-column--sidebar">
              <section className="webgal-panel webgal-panel--compact webgal-import-panel">
                <div className="webgal-panel-header">
                  <div>
                    <div className="webgal-panel-kicker">Import</div>
                    <h4>导入设置</h4>
                  </div>
                </div>

                <div className="webgal-status-grid webgal-status-grid--compact">
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
                    <div className="webgal-role-list webgal-role-list--compact">
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

                    <div className="webgal-inline-grid webgal-inline-grid--compact">
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

                    <label className="webgal-toggle-row">
                      <input
                        type="checkbox"
                        checked={includeSubtitles}
                        onChange={(event) => setIncludeSubtitles(event.target.checked)}
                      />
                      <span>
                        导入对白字幕
                        <small>对白文本会生成字幕轨，并与动作、表情、语音保持同起止时长。</small>
                      </span>
                    </label>

                    <label className="webgal-toggle-row">
                      <input
                        type="checkbox"
                        checked={extendClipToSpokenSpan}
                        onChange={(event) => setExtendClipToSpokenSpan(event.target.checked)}
                      />
                      <span>
                        片段延长覆盖插话
                        <small>勾选后动作和字幕会延长到后续对白结束，但语音只播放原始长度。</small>
                      </span>
                    </label>
                  </>
                ) : (
                  <div className="webgal-empty">
                    <strong>还没有可选角色</strong>
                    <span>先选择项目并粘贴脚本，系统才会生成单角色导入选项。</span>
                  </div>
                )}
              </section>

            </div>
          </div>
        </div>

        <div className="webgal-actions">
          <div className="webgal-actions-copy">
            <strong>导入单角色时间线</strong>
            <span>当前会替换现有时间线内容，并把选定立绘加载到预览区。单角色片段时长会从该角色当前一句开始，持续到该角色下一句开始前，期间会包含其他角色的说话时长；没有语音时再按动作时长回退。</span>
          </div>
          <div className="webgal-actions-buttons">
            <button
              className="webgal-btn webgal-btn--ghost"
              onClick={() => setShowRoleMappings(true)}
              type="button"
            >
              角色映射表
            </button>
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

        {showRoleMappings ? (
          <div className="webgal-drawer-layer" onClick={() => setShowRoleMappings(false)}>
            <aside className="webgal-drawer" onClick={(event) => event.stopPropagation()}>
              <div className="webgal-panel-header">
                <div>
                  <div className="webgal-panel-kicker">Mapping</div>
                  <h4>角色映射表</h4>
                </div>
                <button className="webgal-icon-btn" onClick={() => setShowRoleMappings(false)} aria-label="关闭角色映射表">
                  ×
                </button>
              </div>

              <p className="webgal-drawer-copy">这里直接编辑完整 JSON。格式示例：{"{"}"anon": "千早爱音"{"}"}，内容合法时会立即写入本地记录。</p>

              <div className="webgal-json-editor-shell">
                <textarea
                  className="webgal-json-editor"
                  value={roleMappingEditorText}
                  onChange={(event) => void handleRoleMappingEditorChange(event.target.value)}
                  spellCheck={false}
                />
              </div>

              <div className="webgal-drawer-status">
                <span className={`webgal-chip webgal-chip--state ${roleMappingEditorError ? "is-error" : "is-ready"}`}>
                  {roleMappingEditorError ? "JSON 无效" : "JSON 有效"}
                </span>
                <span className="webgal-drawer-meta">当前映射 {Object.keys(roleNameMap).length} 项</span>
              </div>
              {roleMappingEditorError ? (
                <p className="webgal-drawer-error">{roleMappingEditorError}</p>
              ) : null}
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}
