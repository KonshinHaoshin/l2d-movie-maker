// 角色管理面板
import React, { useState } from "react";
import type { Character } from "../../types/character";
import { WebGALParser, type WebGALCommand } from "../../utils/webgalParser";

interface CharacterPanelProps {
  characters: Character[];
  activeCharacterId: string | null;
  onAddCharacter: (character: Character) => void;
  onRemoveCharacter: (id: string) => void;
  onSelectCharacter: (id: string | null) => void;
  onUpdateCharacter: (id: string, updates: Partial<Character>) => void;
  onImportWebGAL: (commands: WebGALCommand[]) => void;
  modelList: string[];
}

export function CharacterPanel({
  characters,
  activeCharacterId,
  onAddCharacter,
  onRemoveCharacter,
  onSelectCharacter,
  onUpdateCharacter,
  onImportWebGAL,
  modelList,
}: CharacterPanelProps) {
  const [showWebGALImport, setShowWebGALImport] = useState(false);
  const [webgalScript, setWebgalScript] = useState("");
  const [webgalError, setWebgalError] = useState("");

  const activeCharacter = characters.find(c => c.id === activeCharacterId);

  // 添加新角色
  const handleAddCharacter = () => {
    if (modelList.length === 0) {
      alert("没有可用的模型，请先在模型文件夹中添加模型");
      return;
    }
    const defaultModel = modelList[0];
    const name = prompt("输入角色名称:", defaultModel.replace(/\.(jsonl|json)$/i, ""));
    if (!name) return;

    const newChar: Character = {
      id: `char_${Date.now()}`,
      name,
      modelPath: defaultModel,
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      zIndex: characters.length,
    };
    onAddCharacter(newChar);
    onSelectCharacter(newChar.id);
  };

  // 导入 WebGAL 脚本
  const handleImportWebGAL = () => {
    const parser = new WebGALParser();
    try {
      const commands = parser.parseScript(webgalScript);
      if (commands.length === 0) {
        setWebgalError("未解析到任何命令");
        return;
      }
      onImportWebGAL(commands);
      setShowWebGALImport(false);
      setWebgalScript("");
      setWebgalError("");
    } catch (e: any) {
      setWebgalError(`解析失败: ${e.message}`);
    }
  };

  return (
    <div className="character-panel">
      <div className="character-panel-header">
        <h3>🎭 角色管理</h3>
        <div className="character-panel-actions">
          <button onClick={() => setShowWebGALImport(true)} title="导入 WebGAL 脚本">
            📥 WebGAL
          </button>
          <button onClick={handleAddCharacter} title="添加角色">
            ➕ 添加
          </button>
        </div>
      </div>

      {/* 角色列表 */}
      <div className="character-list">
        {characters.length === 0 ? (
          <div className="character-list-empty">
            暂无角色，点击"添加"创建第一个角色
          </div>
        ) : (
          characters.map(char => (
            <div
              key={char.id}
              className={`character-item ${activeCharacterId === char.id ? "active" : ""}`}
              onClick={() => onSelectCharacter(char.id)}
            >
              <span className="character-name">{char.name}</span>
              <span className="character-path">{char.modelPath.split("/").pop()}</span>
              <button
                className="character-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`删除角色 "${char.name}"?`)) {
                    onRemoveCharacter(char.id);
                  }
                }}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* 角色编辑区 */}
      {activeCharacter && (
        <div className="character-editor">
          <h4>编辑: {activeCharacter.name}</h4>
          
          <div className="character-editor-field">
            <label>模型:</label>
            <select
              value={activeCharacter.modelPath}
              onChange={(e) => onUpdateCharacter(activeCharacter.id, { modelPath: e.target.value })}
            >
              {modelList.map(m => (
                <option key={m} value={m}>{m.split("/").pop()}</option>
              ))}
            </select>
          </div>

          <div className="character-editor-row">
            <div className="character-editor-field">
              <label>X:</label>
              <input
                type="number"
                value={activeCharacter.x}
                onChange={(e) => onUpdateCharacter(activeCharacter.id, { x: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="character-editor-field">
              <label>Y:</label>
              <input
                type="number"
                value={activeCharacter.y}
                onChange={(e) => onUpdateCharacter(activeCharacter.id, { y: parseFloat(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="character-editor-row">
            <div className="character-editor-field">
              <label>缩放:</label>
              <input
                type="number"
                step="0.1"
                value={activeCharacter.scale}
                onChange={(e) => onUpdateCharacter(activeCharacter.id, { scale: parseFloat(e.target.value) || 1 })}
              />
            </div>
            <div className="character-editor-field">
              <label>层级:</label>
              <input
                type="number"
                value={activeCharacter.zIndex}
                onChange={(e) => onUpdateCharacter(activeCharacter.id, { zIndex: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="character-editor-field">
            <label>透明度:</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={activeCharacter.opacity}
              onChange={(e) => onUpdateCharacter(activeCharacter.id, { opacity: parseFloat(e.target.value) })}
            />
            <span>{Math.round(activeCharacter.opacity * 100)}%</span>
          </div>
        </div>
      )}

      {/* WebGAL 导入弹窗 */}
      {showWebGALImport && (
        <div className="webgal-import-modal">
          <div className="webgal-import-content">
            <h4>📥 导入 WebGAL 脚本</h4>
            <textarea
              value={webgalScript}
              onChange={(e) => setWebgalScript(e.target.value)}
              placeholder={`# 示例脚本
changeFigure: 模型路径/xxx.jsonl -id=角色1 -motion=动作名 -expression=表情名;
角色1: 你好呀！ -audio/voice1.wav;
setPosition: 100,200;
`}
              rows={10}
            />
            {webgalError && <div className="webgal-error">{webgalError}</div>}
            <div className="webgal-import-actions">
              <button onClick={() => setShowWebGALImport(false)}>取消</button>
              <button onClick={handleImportWebGAL} className="primary">导入到时间线</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
