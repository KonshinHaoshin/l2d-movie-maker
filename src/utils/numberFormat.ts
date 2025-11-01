/**
 * 安全的数字格式化工具函数
 * 确保即使输入是非数字类型也不会抛出错误
 */

/**
 * 安全地将值转换为固定小数位数的字符串
 * @param value - 要格式化的值（可以是任何类型）
 * @param decimals - 小数位数
 * @returns 格式化后的字符串
 */
export function safeToFixed(value: any, decimals: number = 2): string {
  try {
    // 先转换为数字
    const num = Number(value);
    
    // 检查是否为有效数字
    if (isNaN(num) || !isFinite(num)) {
      return '0.' + '0'.repeat(decimals);
    }
    
    // 返回格式化后的字符串
    return num.toFixed(decimals);
  } catch (error) {
    // 如果出错，返回默认值
    console.warn('safeToFixed 转换失败:', value, error);
    return '0.' + '0'.repeat(decimals);
  }
}

/**
 * 安全地格式化秒数
 * @param seconds - 秒数
 * @returns 格式化后的字符串（如 "1.23s"）
 */
export function formatSeconds(seconds: any, decimals: number = 2): string {
  return `${safeToFixed(seconds, decimals)}s`;
}

/**
 * 安全地格式化百分比
 * @param value - 百分比值（0-100）
 * @param decimals - 小数位数
 * @returns 格式化后的字符串（如 "45.6%"）
 */
export function formatPercent(value: any, decimals: number = 1): string {
  return `${safeToFixed(value, decimals)}%`;
}






