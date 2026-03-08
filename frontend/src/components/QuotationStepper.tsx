/** 報價流程四步驟 Stepper */
import { Check } from 'lucide-react'

const STEPS = [
  { num: 1, label: '需求解析' },
  { num: 2, label: '確認需求' },
  { num: 3, label: '產生報價' },
  { num: 4, label: '檢視輸出' },
] as const

export interface QuotationStepperProps {
  currentStep: 1 | 2 | 3 | 4
  completedSteps: number[]
  onStepClick?: (step: number) => void
}

export default function QuotationStepper({
  currentStep,
  completedSteps,
  onStepClick,
}: QuotationStepperProps) {
  return (
    <nav className="flex shrink-0 items-center justify-between" aria-label="報價流程步驟">
      {STEPS.map((step, idx) => {
        const isCompleted = completedSteps.includes(step.num)
        const isCurrent = currentStep === step.num
        const canClick = isCompleted && onStepClick

        return (
          <div key={step.num} className="flex flex-1 items-center">
            <button
              type="button"
              onClick={() => canClick && onStepClick(step.num)}
              disabled={!canClick}
              className={`flex flex-1 flex-col items-center gap-1 py-2 transition-colors ${
                canClick ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
              }`}
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={`步驟 ${step.num}：${step.label}`}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  isCompleted
                    ? 'bg-gray-700 text-white'
                    : isCurrent
                      ? 'border-2 border-gray-700 bg-white text-gray-800'
                      : 'border border-gray-300 bg-gray-100 text-gray-500'
                }`}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : step.num}
              </span>
              <span
                className={`text-xs font-medium ${
                  isCurrent ? 'text-gray-800' : isCompleted ? 'text-gray-600' : 'text-gray-400'
                }`}
              >
                {step.label}
              </span>
            </button>
            {idx < STEPS.length - 1 && (
              <div
                className={`h-0.5 flex-1 ${completedSteps.includes(step.num) ? 'bg-gray-700' : 'bg-gray-200'}`}
                aria-hidden
              />
            )}
          </div>
        )
      })}
    </nav>
  )
}
