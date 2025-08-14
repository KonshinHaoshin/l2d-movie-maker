// 端口配置文件
export const PORTS = {
  // 开发服务器端口
  DEV_SERVER: 1431,
  
  // 静态资源服务器端口（由Tauri服务器动态分配）
  STATIC_SERVER: 1431,
  
  // 备用端口
  FALLBACK: 1430
} as const;

// 获取当前环境的端口
export const getCurrentPort = (): number => {
  // 优先使用环境变量中的端口（Tauri服务器分配的）
  const envPort = process.env.VITE_TAURI_SERVER_PORT;
  if (envPort) {
    return parseInt(envPort, 10);
  }
  
  // 备用：使用配置的端口
  return PORTS.DEV_SERVER;
};

// 获取资源基础URL
export const getResourceBaseUrl = (): string => {
  const port = getCurrentPort();
  return `http://127.0.0.1:${port}`;
};

// 获取模型资源URL
export const getModelResourceUrl = (path: string): string => {
  const baseUrl = getResourceBaseUrl();
  return `${baseUrl}/model/${path}`;
};

// 获取figure资源URL
export const getFigureResourceUrl = (path: string): string => {
  const baseUrl = getResourceBaseUrl();
  return `${baseUrl}/figure/${path}`;
}; 