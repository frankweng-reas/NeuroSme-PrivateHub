/** 模型選擇下拉選單共用元件 */
import { MODEL_OPTIONS } from '@/constants/aiOptions'

export interface ModelSelectProps {
  value: string
  onChange: (v: string) => void
  id?: string
  label?: string
  className?: string
  labelClassName?: string
  selectClassName?: string
  disabled?: boolean
}

export default function ModelSelect({
  value,
  onChange,
  id,
  label = '模型',
  className = '',
  labelClassName = 'shrink-0 text-[16px] font-medium text-gray-700',
  selectClassName = 'min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400',
  disabled = false,
}: ModelSelectProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {label && (
        <label htmlFor={id} className={labelClassName}>
          {label}
        </label>
      )}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={selectClassName}
      >
        {MODEL_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
