# Live2D 录制器

一个基于 React + TypeScript + Tauri 的 Live2D 模型播放器，支持模型选择、动作播放和表情切换。

## ✨ 功能特性

- 🎭 **Live2D 模型播放**: 支持标准的 Live2D 模型格式
- 📁 **模型选择器**: 预设模型和自定义路径选择
- 😊 **表情控制**: 动态切换模型表情
- 🎬 **动作播放**: 播放各种预设动作
- 🎨 **现代化UI**: 美观的控制面板和交互体验
- 🖱️ **点击交互**: 点击模型触发随机动作
- 📱 **响应式设计**: 支持窗口大小调整

## 🚀 快速开始

### 环境要求

- Node.js 18+
- Rust 1.70+
- Tauri CLI

### 安装依赖

```bash
# 安装前端依赖
npm install

# 安装 Rust 依赖 (Tauri 会自动处理)
```

### 开发模式

```bash
# 启动前端开发服务器
npm run dev

# 启动 Tauri 开发模式
npm run tauri:dev
```

### 构建应用

```bash
# 构建前端
npm run build

# 构建 Tauri 应用
npm run tauri:build
```

## 📖 使用说明

### 1. 选择模型

- **预设模型**: 从下拉菜单选择 "Anon (匿名)" 或 "Soyo (そよ)"
- **自定义路径**: 点击 "输入自定义模型路径" 按钮，输入模型目录路径

### 2. 播放表情

模型加载完成后，在 "选择表情" 下拉菜单中选择想要的表情：
- `angry01` - 生气表情
- `smile01` - 微笑表情
- `cry01` - 哭泣表情
- `surprised01` - 惊讶表情
- 等等...

### 3. 播放动作

在 "选择动作" 下拉菜单中选择动作组：
- `idle01` - 待机动作
- `angry01` - 生气动作
- `smile01` - 微笑动作
- `thinking01` - 思考动作
- 等等...

### 4. 快速动作

使用快速动作按钮快速播放常用动作，支持：
- 点击按钮直接播放
- 悬停效果和动画
- 最多显示6个快速动作

### 5. 交互操作

- **点击模型**: 随机播放一个可用动作
- **窗口调整**: 模型自动居中显示
- **实时状态**: 显示加载状态和错误信息

## 🗂️ 项目结构

```
live2d_recorder/
├── src/
│   ├── components/
│   │   ├── Live2DView.tsx      # 主播放器组件
│   │   └── ModelSelector.tsx   # 模型选择器组件
│   ├── App.tsx                 # 主应用组件
│   └── main.tsx               # 应用入口
├── public/
│   └── model/                  # Live2D 模型文件
│       ├── anon/               # 匿名模型
│       └── soyo/               # そよ模型
├── src-tauri/                  # Tauri 后端
└── package.json
```

## 🔧 技术栈

- **前端**: React 18 + TypeScript + Vite
- **渲染**: PIXI.js + pixi-live2d-display
- **桌面**: Tauri 2.0 + Rust
- **样式**: 内联 CSS + 响应式设计

## 📝 Live2D 模型要求

你的 Live2D 模型需要包含以下文件结构：

```
model/
├── model.json          # 模型配置文件
├── model.moc          # 模型文件
├── texture_00.png     # 纹理文件
├── expressions/        # 表情文件 (可选)
└── motions/           # 动作文件 (可选)
```

### model.json 示例

```json
{
  "model": "model.moc",
  "textures": ["texture_00.png"],
  "expressions": [
    {
      "name": "smile01",
      "file": "expressions/smile01.exp.json"
    }
  ],
  "motions": {
    "idle01": [
      {
        "file": "motions/idle01.mtn"
      }
    ]
  }
}
```

## 🐛 故障排除

### 常见问题

1. **模型加载失败**
   - 检查模型路径是否正确
   - 确保 model.json 文件存在且格式正确
   - 检查浏览器控制台错误信息

2. **表情/动作无法播放**
   - 确认模型文件包含对应的表情和动作
   - 检查文件路径是否正确
   - 查看控制台日志信息

3. **Tauri 构建错误**
   - 确保 Rust 版本兼容
   - 检查 Tauri 配置文件
   - 清理并重新安装依赖

### 调试模式

```bash
# 启用调试模式
npm run tauri:dev -- --debug

# 查看详细日志
npm run tauri:dev -- --log-level debug
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🙏 致谢

- [Live2D](https://www.live2d.com/) - Live2D 技术
- [PIXI.js](https://pixijs.com/) - 2D 渲染引擎
- [Tauri](https://tauri.app/) - 桌面应用框架
- [React](https://reactjs.org/) - 前端框架
