/** 分段选择器（替代 antd Segmented）：页签/视图切换两用 */
export function TvSegmented<T extends string>({ value, onChange, options, className }: {
  value: T;
  onChange: (v: T) => void;
  options: { label: string; value: T }[];
  className?: string;
}) {
  return (
    <div className={"tv-segmented" + (className ? " " + className : "")} role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value}
                className={"tv-segmented-item" + (value === o.value ? " active" : "")}
                onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
