import { faBars, faMinus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { TvTooltip } from "../ui/TvTooltip";

interface WrapToggleButtonProps {
  /** 当前是否自动换行 */
  wrapped: boolean;
  /** 点击切换换行状态 */
  onToggle: () => void;
}

/** 换行切换按钮（Markdown 代码块用）：图标表达当前状态，Tooltip/aria 提示当前状态 */
export default function WrapToggleButton({ wrapped, onToggle }: WrapToggleButtonProps) {
  const label = wrapped ? "自动换行" : "不自动换行";
  return (
    <TvTooltip title={label}>
      <button
        type="button"
        className="tv-code-wrap-toggle"
        aria-label={label}
        onClick={onToggle}
      >
        <FontAwesomeIcon icon={wrapped ? faBars : faMinus} />
      </button>
    </TvTooltip>
  );
}
