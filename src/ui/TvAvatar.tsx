import { avatarColor } from "./avatarColor";

/** 圆形首字母头像（替代 antd Avatar）：用户名哈希取色，白字可读 */
export function TvAvatar({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <span className="tv-avatar"
          style={{ width: size, height: size, background: avatarColor(name), fontSize: size / 2 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
