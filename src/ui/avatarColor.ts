/** 用户名哈希取色(批注卡片头像):djb2 → HSL hue;固定饱和度/亮度保证白字可读 */
export function avatarColor(username: string): string {
  let h = 5381;
  for (const ch of username) h = (h * 33 + ch.codePointAt(0)!) >>> 0;
  return `hsl(${h % 360}, 65%, 45%)`;
}
