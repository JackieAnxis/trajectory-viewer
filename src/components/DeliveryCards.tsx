import { faFolder } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

interface DeliveryCardsProps {
  delivery: string[];
  /** 多文件抽屉开合状态（受控：状态由 RecordDetail 持有，抽屉与内容并排渲染） */
  panelOpen: boolean;
  onTogglePanel: () => void;
}

/**
 * 交付物卡片区（消息流最底部）：
 * 「全部文件」卡片，点击开合右侧抽屉（并排压缩主区域，同左侧侧边栏布局式）。
 * 单/多文件行为一致：预览统一从抽屉内的文件行进入，保证各入口体验相同。
 */
export default function DeliveryCards({ delivery, panelOpen, onTogglePanel }: DeliveryCardsProps) {
  if (!delivery?.length) return null;

  return (
    <div className="tv-delivery-cards">
      <button
        type="button"
        className="tv-delivery-card tv-delivery-card-click"
        onClick={onTogglePanel}
        aria-expanded={panelOpen}
      >
        <span className="tv-delivery-icon"><FontAwesomeIcon icon={faFolder} /></span>
        <span className="tv-delivery-text">
          <span className="tv-delivery-name">全部文件</span>
          <span className="tv-delivery-sub">{delivery.length} 个文件</span>
        </span>
      </button>
    </div>
  );
}
