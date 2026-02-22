// 多角色类型定义

export interface Character {
  id: string;
  name: string;
  modelPath: string;
  motion?: string;
  expression?: string;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  zIndex: number;
  // 运行时
  model?: any;
}

export interface CharacterState {
  characters: Character[];
  activeCharacterId: string | null;
}

export const defaultCharacter = (name: string, modelPath: string): Character => ({
  id: `char_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  name,
  modelPath,
  x: 0,
  y: 0,
  scale: 1,
  opacity: 1,
  zIndex: 0,
});
