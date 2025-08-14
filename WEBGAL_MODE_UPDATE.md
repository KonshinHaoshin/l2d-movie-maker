# WebGAL模式更新说明

## 概述
本次更新大幅简化了WebGAL模式，去除了复杂的路径解析逻辑，直接使用相对路径来加载模型文件，就像普通的模型目录一样。同时增加了对中文路径的支持、多路径尝试机制和智能错误处理。

## 主要功能

### 1. changeFigure命令解析
支持以下格式的`changeFigure`命令：
```
changeFigure: 改模/拼好模/大棉袄/大棉袄.jsonl -id=anon -motion=taki_smile04 -expression=soyo_smile01;
```

**参数说明：**
- `路径/到/模型文件`: 支持.json和.jsonl文件（相对于figure文件夹）
- `-id=角色ID`: 可选的角色标识符
- `-motion=动作名`: 要播放的动作名称
- `-expression=表情名`: 要设置的表情名称

### 2. 智能路径解析
系统会尝试多个路径组合，确保中文路径能够正确加载：

```
你的项目目录/
├── figure/           ← 优先尝试：模型文件根目录
│   ├── 改模/
│   │   └── 拼好模/
│   │       └── 大棉袄/
│   │           └── 大棉袄.jsonl
├── model/            ← 备用路径：备用模型目录
│   └── 改模/
│       └── 拼好模/
│           └── 大棉袄/
│               └── 大棉袄.jsonl
└── 其他文件...
```

**路径尝试顺序：**
1. `figure/改模/拼好模/大棉袄/大棉袄.jsonl` (优先)
2. `model/改模/拼好模/大棉袄/大棉袄.jsonl` (备用)
3. `改模/拼好模/大棉袄/大棉袄.jsonl` (直接路径)

### 3. 智能错误处理
系统现在能够智能识别不同类型的错误：

- **文件不存在**: 自动检测HTML回退页面，继续尝试下一个路径
- **网络错误**: 提供详细的错误信息和状态码
- **格式错误**: 区分JSON解析错误和文件不存在错误

### 4. 自动模型加载
- 解析`changeFigure`命令后，系统会自动：
  - 尝试多个路径组合加载模型文件
  - 设置指定的动作和表情
  - 将动作和表情添加到时间线

### 5. 支持的文件格式
- **.json**: 单个Live2D模型
- **.jsonl**: 复合Live2D模型（多个模型组合）

## 使用示例

### 基本用法
```webgal
changeFigure: 改模/拼好模/大棉袄/大棉袄.jsonl -id=anon -motion=taki_smile04 -expression=soyo_smile01;
千早爱音:吼~这样吗？要是你需要的话也不是不行哦？汪汪！ -anon/wjzs2/anon_wjzs2_09.wav;
```

### 多个角色切换
```webgal
changeFigure: sakiko/casual-墨镜/model.json -id=sakiko -motion=mana_surprised01 -expression=nyamu_surprised01;
丰川祥子:...你不会有什么奇怪的癖好吧？ -sakiko/wjzs2/sakiko_wjzs2_15.wav;
```

## 技术实现

### 智能路径尝试逻辑
```typescript
// 在Live2DView.tsx中实现
const pathVariations = [
  `figure/${figure.path}`,           // 1. figure/改模/拼好模/大棉袄/大棉袄.jsonl
  `model/${figure.path}`,            // 2. model/改模/拼好模/大棉袄/大棉袄.jsonl (备用)
  figure.path                        // 3. 直接使用原始路径
];

for (const path of pathVariations) {
  try {
    await modelManager.loadAnyModel(appRef.current!, path);
    console.log(`✅ 模型加载成功: ${path}`);
    loadSuccess = true;
    break;
  } catch (loadError) {
    // 检查是否是HTML内容错误（文件不存在）
    const errorMessage = loadError instanceof Error ? loadError.message : String(loadError);
    if (errorMessage.includes('<!DOCTYPE html>') || errorMessage.includes('HTML')) {
      console.warn(`⚠️ 路径 ${path} 不存在（返回HTML页面）`);
    } else {
      console.warn(`⚠️ 路径 ${path} 加载失败:`, loadError);
    }
    continue;
  }
}
```

### 智能错误检测
```typescript
// 在ModelManager.tsx中实现
const response = await fetch(jsonlUrl, { cache: "no-cache" });

// 检查响应状态和内容类型
if (!response.ok) {
  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

const text = await response.text();

// 检查是否是HTML内容（文件不存在时的回退页面）
if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
  throw new Error(`文件不存在或路径错误: ${jsonlUrl} (返回HTML页面)`);
}
```

### 模型加载
```typescript
// 系统会自动尝试多个路径，直到成功加载
try {
  await modelManager.loadAnyModel(appRef.current!, path);
  console.log('✅ 模型加载成功:', path);
} catch (loadError) {
  console.warn('⚠️ 路径加载失败，尝试下一个:', loadError);
}
```

## 目录结构要求

为了使用WebGAL模式，请确保你的项目目录结构如下：

```
你的项目目录/
├── figure/                    ← 优先：模型文件目录
│   ├── 改模/
│   │   └── 拼好模/
│   │       └── 大棉袄/
│   │           └── 大棉袄.jsonl
│   └── sakiko/
│       └── casual-墨镜/
│           └── model.json
├── model/                     ← 备用：备用模型目录
│   └── 改模/
│       └── 拼好模/
│           └── 大棉袄/
│               └── 大棉袄.jsonl
├── anon/                      ← 可选：音频文件目录
│   └── wjzs2/
│       └── anon_wjzs2_09.wav
├── sakiko/                    ← 可选：音频文件目录
│   └── wjzs2/
│       └── sakiko_wjzs2_15.wav
└── 你的exe文件.exe
```

## 中文路径支持

### 问题说明
由于中文路径在URL中需要正确编码，系统现在支持多种路径组合：

- **优先路径**: `figure/改模/拼好模/大棉袄/大棉袄.jsonl`
- **备用路径**: `model/改模/拼好模/大棉袄/大棉袄.jsonl`
- **直接路径**: `改模/拼好模/大棉袄/大棉袄.jsonl`

### 自动尝试机制
系统会自动尝试这些路径，直到成功加载模型，确保中文路径能够正常工作。

## 错误处理机制

### 智能错误识别
系统现在能够智能识别不同类型的错误：

1. **文件不存在错误**
   - 检测HTML回退页面
   - 自动尝试下一个路径
   - 提供清晰的错误信息

2. **网络错误**
   - HTTP状态码检查
   - 网络连接问题诊断
   - 详细的错误报告

3. **格式错误**
   - JSON/JSONL解析错误
   - 文件格式验证
   - 内容类型检查

### 错误日志示例
```
🧭 尝试加载模型路径: figure/改模/拼好模/大棉袄/大棉袄.jsonl
⚠️ 路径 figure/改模/拼好模/大棉袄/大棉袄.jsonl 不存在（返回HTML页面）
🧭 尝试加载模型路径: model/改模/拼好模/大棉袄/大棉袄.jsonl
✅ 模型加载成功: model/改模/拼好模/大棉袄/大棉袄.jsonl
```

## 注意事项

1. **文件路径**: 确保模型文件存在于`figure/`或`model/`文件夹中
2. **文件格式**: 支持标准的Live2D模型文件格式
3. **错误处理**: 如果某个路径加载失败，系统会自动尝试下一个路径
4. **性能**: 大型模型文件可能需要一些时间加载
5. **简化设计**: 使用相对路径，无需复杂的配置
6. **中文支持**: 自动处理中文路径的URL编码问题
7. **智能回退**: 自动检测文件不存在并尝试备用路径

## 更新日志

- ✅ 去除游戏目录选择功能
- ✅ 大幅简化路径解析逻辑，直接使用相对路径
- ✅ 去除复杂的文件系统作用域设置
- ✅ 增加智能路径尝试机制
- ✅ 支持中文路径和URL编码
- ✅ 智能错误处理和HTML内容检测
- ✅ 自动模型加载功能
- ✅ 支持.json和.jsonl文件格式
- ✅ 改进用户界面和说明文档
- ✅ 修复表情设置的时间线同步问题

## 兼容性

- 保持与现有WebGAL脚本的兼容性
- 简化了配置，不再需要指定游戏目录
- 专注于相对路径的文件管理
- 与现有的模型加载系统完全兼容
- 支持中文路径和特殊字符
- 智能错误处理，提高系统稳定性 