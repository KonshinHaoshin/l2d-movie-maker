// src/utils/jsonlLoader.ts

export interface JsonlModelConfig {
  index: number;
  id?: string;
  path: string;
  folder?: string;
  x?: number;
  y?: number;
  xscale?: number;
  yscale?: number;
}

export interface JsonlAggregateData {
  motions?: string[];
  expressions?: string[];
  import?: number;
}

export interface ParsedJsonlData {
  models: JsonlModelConfig[];
  aggregate: JsonlAggregateData;
  baseDir: string;
}

/**
 * 解析.jsonl文件内容
 * @param jsonlText .jsonl文件的文本内容
 * @param basePath 文件的基础路径（用于解析相对路径）
 * @returns 解析后的模型配置和聚合数据
 */
export function parseJsonlFile(jsonlText: string, basePath: string): ParsedJsonlData {
  const lines = jsonlText.split('\n').filter(Boolean);
  const models: JsonlModelConfig[] = [];
  let aggregate: JsonlAggregateData = {};
  
  // 获取基础目录
  const baseDir = basePath.substring(0, basePath.lastIndexOf('/') + 1);
  
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      
      // 判断是否是汇总参数行（包含motions或expressions）
      if (obj?.motions || obj?.expressions) {
        aggregate = obj;
        continue;
      }
      
      // 判断是否是模型配置行（包含path字段）
      if (obj?.path) {
        let fullPath = obj.path;
        
        // 处理相对路径
        if (!obj.path.startsWith('http') && !obj.path.startsWith('game/')) {
          fullPath = baseDir + obj.path.replace(/^\.\//, '');
        }
        
        models.push({
          index: obj.index || 0,
          id: obj.id,
          path: fullPath,
          folder: obj.folder,
          x: obj.x,
          y: obj.y,
          xscale: obj.xscale,
          yscale: obj.yscale,
        });
      }
    } catch (e) {
      console.warn('JSONL parse error in line:', line, e);
    }
  }
  
  return { models, aggregate, baseDir };
}

/**
 * 验证.jsonl文件是否有效
 * @param jsonlText .jsonl文件的文本内容
 * @returns 是否有效
 */
export function validateJsonlFile(jsonlText: string): boolean {
  const lines = jsonlText.split('\n').filter(Boolean);
  if (lines.length === 0) return false;
  
  let hasModelLine = false;
  let hasAggregateLine = false;
  
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      
      if (obj?.path) {
        hasModelLine = true;
      }
      
      if (obj?.motions || obj?.expressions) {
        hasAggregateLine = true;
      }
      
      // 如果既有模型行又有汇总行，说明文件有效
      if (hasModelLine && hasAggregateLine) {
        return true;
      }
    } catch (e) {
      // 忽略解析错误的行
    }
  }
  
  return hasModelLine; // 至少要有模型行
}

/**
 * 从.jsonl文件加载模型配置
 * @param jsonlPath .jsonl文件的路径
 * @returns 解析后的数据
 */
export async function loadJsonlConfig(jsonlPath: string): Promise<ParsedJsonlData> {
  try {
    const response = await fetch(jsonlPath);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const jsonlText = await response.text();
    
    if (!validateJsonlFile(jsonlText)) {
      throw new Error('Invalid .jsonl file format');
    }
    
    return parseJsonlFile(jsonlText, jsonlPath);
  } catch (error) {
    console.error('Failed to load .jsonl config:', error);
    throw error;
  }
}

/**
 * 获取.jsonl文件中定义的所有动作名称
 * @param aggregate 聚合数据
 * @returns 动作名称数组
 */
export function getMotionsFromJsonl(aggregate: JsonlAggregateData): string[] {
  return aggregate.motions || [];
}

/**
 * 获取.jsonl文件中定义的所有表情名称
 * @param aggregate 聚合数据
 * @returns 表情名称数组
 */
export function getExpressionsFromJsonl(aggregate: JsonlAggregateData): string[] {
  return aggregate.expressions || [];
}

/**
 * 获取.jsonl文件中的import参数值
 * @param aggregate 聚合数据
 * @returns import值，如果不存在则返回null
 */
export function getImportFromJsonl(aggregate: JsonlAggregateData): number | null {
  return aggregate.import ?? null;
} 