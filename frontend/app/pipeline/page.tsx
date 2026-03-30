'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import {
  Play, RefreshCw, ChevronDown, ChevronRight, FileText,
  AlertCircle, CheckCircle2, Clock, XCircle, SkipForward,
  RotateCcw, StopCircle, Send, Bot, User, Sparkles,
  CalendarClock, Trash2, CalendarPlus, Pencil,
  FolderOpen, Plus, ArrowDown, MoveUp, MoveDown, Settings2, Layers,
  Code2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getPipelineRuns, startPipeline, resumePipeline, getPipelineLog, pipelineChat,
  getPipelineScheduled, createPipelineSchedule, deletePipelineSchedule,
  deletePipelineRun, fsBrowse, fsCheckVenv,
} from '@/lib/api'
import type { PipelineRun, ScheduledTask } from '@/lib/types'
import ReactMarkdown from 'react-markdown'

// ── Types ──────────────────────────────────────────────────
interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  hasYaml?: boolean
}

// ── Constants ──────────────────────────────────────────────
const EXAMPLE_YAML = `pipeline:
  name: 我的自動化流程

  steps:
    - name: 步驟一
      batch: bash ~/scripts/step1.sh
      timeout: 300
      retry: 1
      output:
        path: ~/data/output.csv
        expect: "CSV 檔案，不為空，包含正確欄位"

    - name: 步驟二
      batch: bash ~/scripts/step2.sh
      timeout: 300
      retry: 1
`

const STATUS_CONFIG = {
  running:        { label: '執行中',    icon: Clock,        color: 'text-blue-500',  bg: 'bg-blue-50' },
  awaiting_human: { label: '等待決策', icon: AlertCircle,  color: 'text-amber-500', bg: 'bg-amber-50' },
  completed:      { label: '已完成',   icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
  failed:         { label: '失敗',      icon: XCircle,      color: 'text-red-500',   bg: 'bg-red-50' },
  aborted:        { label: '已中止',   icon: StopCircle,   color: 'text-gray-500',  bg: 'bg-gray-100' },
} as const

const STEP_STATUS_ICON = {
  ok:      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />,
  warning: <AlertCircle  className="w-4 h-4 text-amber-500 shrink-0" />,
  failed:  <XCircle      className="w-4 h-4 text-red-500 shrink-0" />,
}

// ── Sub-components ─────────────────────────────────────────
function StatusBadge({ status }: { status: PipelineRun['status'] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.failed
  const Icon = cfg.icon
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.bg, cfg.color)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  )
}

function RunCard({ run, onRefresh, onEdit }: {
  run: PipelineRun
  onRefresh: () => void
  onEdit: (yaml: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [log, setLog] = useState('')
  const [loadingLog, setLoadingLog] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const totalSteps = run.config_dict?.steps?.length ?? 0

  const handleDecision = async (decision: 'retry' | 'skip' | 'abort') => {
    setDeciding(true)
    try {
      const res = await resumePipeline(run.run_id, decision)
      toast.success(res.message)
      onRefresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失敗')
    } finally {
      setDeciding(false)
    }
  }

  const handleShowLog = async () => {
    if (showLog) { setShowLog(false); return }
    setLoadingLog(true)
    try {
      const res = await getPipelineLog(run.run_id)
      setLog(res.log)
      setShowLog(true)
    } catch { toast.error('取得 log 失敗') }
    finally { setLoadingLog(false) }
  }

  const handleDelete = async () => {
    if (!confirm(`確定刪除「${run.pipeline_name}」的執行紀錄？`)) return
    setDeleting(true)
    try {
      await deletePipelineRun(run.run_id)
      toast.success('已刪除')
      onRefresh()
    } catch { toast.error('刪除失敗') }
    finally { setDeleting(false) }
  }

  const handleEdit = () => {
    // 把此 run 的 config 轉回 YAML 填入編輯器
    const cfg = run.config_dict
    const steps = (cfg.steps ?? []).map((s: Record<string, unknown>) => {
      const lines = [`    - name: ${s.name}`, `      batch: ${s.batch}`, `      timeout: ${s.timeout ?? 300}`, `      retry: ${s.retry ?? 1}`]
      if (s.output && typeof s.output === 'object') {
        const o = s.output as Record<string, string>
        lines.push(`      output:`, `        path: ${o.path ?? ''}`, `        expect: "${o.expect ?? ''}"`)
      }
      return lines.join('\n')
    }).join('\n\n')
    const yaml = `pipeline:\n  name: ${cfg.name}\n\n  steps:\n${steps}\n`
    onEdit(yaml)
    toast.success('已載入到編輯器，可修改後重新執行')
  }

  const duration = run.ended_at && run.started_at
    ? (() => {
        const secs = Math.round((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 1000)
        return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`
      })()
    : null

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-white flex items-center gap-3">
        <button onClick={() => setExpanded(v => !v)} className="shrink-0 text-gray-400 hover:text-gray-600">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 text-sm truncate">{run.pipeline_name}</span>
            <StatusBadge status={run.status} />
            {duration && <span className="text-xs text-gray-400">{duration}</span>}
          </div>
          <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
            <span>ID: {run.run_id}</span>
            <span>·</span>
            <span>{new Date(run.started_at).toLocaleString('zh-TW')}</span>
            <span>·</span>
            <span>{run.step_results.length}/{totalSteps} 步完成</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleEdit}
            title="載入到編輯器修改"
            className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="刪除此紀錄"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleShowLog}
            disabled={loadingLog}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <FileText className="w-3 h-3" />
            {loadingLog ? '...' : 'Log'}
          </button>
          {run.status === 'awaiting_human' && (
            <>
              <button onClick={() => handleDecision('retry')} disabled={deciding}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors">
                <RotateCcw className="w-3 h-3" /> 重試
              </button>
              <button onClick={() => handleDecision('skip')} disabled={deciding}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition-colors">
                <SkipForward className="w-3 h-3" /> 跳過
              </button>
              <button onClick={() => handleDecision('abort')} disabled={deciding}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 transition-colors">
                <StopCircle className="w-3 h-3" /> 中止
              </button>
            </>
          )}
        </div>
      </div>

      {totalSteps > 0 && (
        <div className="px-4 pb-2 flex gap-1">
          {Array.from({ length: totalSteps }).map((_, i) => {
            const result = run.step_results.find(r => r.step_index === i)
            const color = !result ? 'bg-gray-100'
              : result.validation_status === 'ok' ? 'bg-green-400'
              : result.validation_status === 'warning' ? 'bg-amber-400'
              : 'bg-red-400'
            return <div key={i} className={cn('h-1.5 flex-1 rounded-full', color)} />
          })}
        </div>
      )}

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-2">
          {run.config_dict?.steps?.map((step, i) => {
            const result = run.step_results.find(r => r.step_index === i)
            const isCurrent = run.status === 'running' && i === run.current_step
            return (
              <div key={i} className="flex items-start gap-2.5 p-2.5 bg-white rounded-lg border border-gray-100">
                <div className="mt-0.5">
                  {result ? STEP_STATUS_ICON[result.validation_status]
                    : isCurrent ? <Clock className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
                    : <div className="w-4 h-4 rounded-full border-2 border-gray-200 shrink-0" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800">{step.name}</div>
                  <code className="text-xs text-gray-500 font-mono truncate block">{step.batch}</code>
                  {result && (
                    <div className="mt-1.5 space-y-1">
                      {result.validation_reason && (
                        <div className={cn('text-xs px-2 py-1 rounded',
                          result.validation_status === 'ok' ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50')}>
                          {result.validation_reason}
                        </div>
                      )}
                      {result.validation_suggestion && result.validation_status !== 'ok' && (
                        <div className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded">
                          💡 {result.validation_suggestion}
                        </div>
                      )}
                      {result.stdout_tail && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-gray-400 hover:text-gray-600">stdout</summary>
                          <pre className="mt-1 p-2 bg-gray-900 text-gray-100 rounded text-[11px] overflow-x-auto whitespace-pre-wrap">{result.stdout_tail}</pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
                {result && (
                  <div className="text-xs text-gray-400 shrink-0">
                    exit {result.exit_code}
                    {result.retries_used > 0 && <span className="ml-1 text-amber-500">重試{result.retries_used}次</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showLog && (
        <div className="border-t border-gray-100">
          <pre className="p-4 text-[11px] font-mono bg-gray-900 text-gray-100 overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap">
            {log || '（無 log）'}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── AI YAML Assistant Chat ─────────────────────────────────
function YamlAssistant({ onYamlReady }: { onYamlReady: (yaml: string) => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: 'assistant',
      content: '你好！我來幫你設定 Pipeline。\n\n請用自然語言描述你想自動化的工作流程，例如：\n\n「我有兩個 Python 腳本，第一個抓資料存成 CSV，第二個讀取 CSV 產出報表，都放在 ~/scripts/ 目錄下」\n\n我會反問你需要的細節，直到設定完整為止。',
    }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [yamlReady, setYamlReady] = useState(false)
  const [extractedYaml, setExtractedYaml] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    const newMessages: ChatMsg[] = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await pipelineChat(
        newMessages.map(m => ({ role: m.role, content: m.content }))
      )
      const assistantMsg: ChatMsg = {
        role: 'assistant',
        content: res.reply,
        hasYaml: res.has_yaml,
      }
      setMessages(prev => [...prev, assistantMsg])

      if (res.has_yaml && res.yaml_content) {
        setYamlReady(true)
        setExtractedYaml(res.yaml_content)
      }
    } catch (e) {
      toast.error('AI 回應失敗，請再試一次')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleUseYaml = () => {
    onYamlReady(extractedYaml)
    toast.success('YAML 已填入編輯器，可以開始執行！')
  }

  const handleReset = () => {
    setMessages([{
      role: 'assistant',
      content: '重新開始！請描述你的工作流程。',
    }])
    setYamlReady(false)
    setExtractedYaml('')
  }

  return (
    <div className="flex flex-col h-full border-r border-gray-200">
      {/* Chat header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center">
          <Bot className="w-4 h-4 text-brand-600" />
        </div>
        <div>
          <div className="text-sm font-medium text-gray-900">AI Pipeline 助手</div>
          <div className="text-xs text-gray-400">用自然語言描述流程，AI 幫你寫 YAML</div>
        </div>
        {(messages.length > 1) && (
          <button onClick={handleReset} className="ml-auto text-xs text-gray-400 hover:text-gray-600">重新開始</button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex gap-2.5', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
            <div className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5',
              msg.role === 'user' ? 'bg-brand-600' : 'bg-gray-100'
            )}>
              {msg.role === 'user'
                ? <User className="w-3.5 h-3.5 text-white" />
                : <Bot className="w-3.5 h-3.5 text-gray-600" />
              }
            </div>
            <div className={cn(
              'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm',
              msg.role === 'user'
                ? 'bg-brand-600 text-white rounded-tr-sm'
                : 'bg-gray-100 text-gray-800 rounded-tl-sm'
            )}>
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-code:text-brand-600 prose-code:bg-brand-50 prose-code:px-1 prose-code:rounded [&_pre]:text-[11px] [&_pre]:leading-relaxed">
                  <ReactMarkdown>{msg.content.replace('YAML_READY', '')}</ReactMarkdown>
                </div>
              ) : (
                <span className="whitespace-pre-wrap">{msg.content}</span>
              )}

              {/* YAML Ready action */}
              {msg.hasYaml && (
                <button
                  onClick={handleUseYaml}
                  className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-green-600 text-white text-xs font-medium hover:bg-green-700 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  使用此 YAML 設定，準備執行！
                </button>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-gray-600" />
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-100 shrink-0">
        <div className="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你的工作流程... (Enter 送出)"
            rows={2}
            disabled={loading}
            className="flex-1 resize-none bg-transparent outline-none text-sm text-gray-900 placeholder-gray-400 leading-relaxed disabled:opacity-60 max-h-32"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-600 text-white transition-all hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Schedule Dialog ────────────────────────────────────────
type ScheduleMode = 'once' | 'daily' | 'weekly' | 'custom'

function ScheduleDialog({
  yamlContent,
  pipelineName,
  validateLLM,
  onClose,
  onCreated,
}: {
  yamlContent: string
  pipelineName: string
  validateLLM: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  const [name, setName] = useState(pipelineName || '我的 Pipeline 排程')
  const [mode, setMode] = useState<ScheduleMode>('once')
  // once
  const [onceDate, setOnceDate] = useState(todayStr)
  const [onceHour, setOnceHour] = useState(pad(now.getHours() + 1 < 24 ? now.getHours() + 1 : 8))
  const [onceMin, setOnceMin] = useState('00')
  // daily
  const [dailyHour, setDailyHour] = useState('08')
  const [dailyMin, setDailyMin] = useState('00')
  // weekly
  const [weekDay, setWeekDay] = useState('1')
  const [weekHour, setWeekHour] = useState('08')
  const [weekMin, setWeekMin] = useState('00')
  // custom cron
  const [customCron, setCustomCron] = useState('0 8 * * *')
  const [saving, setSaving] = useState(false)

  const WEEK_DAYS = ['日', '一', '二', '三', '四', '五', '六']
  const HOURS = Array.from({ length: 24 }, (_, i) => pad(i))
  const MINS = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']

  const buildSchedule = (): { type: string; expr: string; label: string } => {
    switch (mode) {
      case 'once':
        return {
          type: 'once',
          expr: `${onceDate}T${onceHour}:${onceMin}:00`,
          label: `${onceDate} ${onceHour}:${onceMin}（單次）`,
        }
      case 'daily':
        return {
          type: 'cron',
          expr: `${onceMin === dailyMin ? dailyMin : dailyMin} ${dailyHour} * * *`,
          label: `每天 ${dailyHour}:${dailyMin}`,
        }
      case 'weekly':
        return {
          type: 'cron',
          expr: `${weekMin} ${weekHour} * * ${weekDay}`,
          label: `每週${WEEK_DAYS[Number(weekDay)]} ${weekHour}:${weekMin}`,
        }
      case 'custom':
        return { type: 'cron', expr: customCron, label: `自訂：${customCron}` }
    }
  }

  const handleSave = async () => {
    const { type, expr, label } = buildSchedule()
    setSaving(true)
    try {
      await createPipelineSchedule({
        name,
        yaml_content: yamlContent,
        schedule_type: type,
        schedule_expr: expr,
        validate: validateLLM,
      })
      toast.success(`排程「${name}」已建立 — ${label}`)
      onCreated()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '建立失敗')
    } finally {
      setSaving(false)
    }
  }

  const schedule = buildSchedule()

  const inputCls = 'border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-500/20 bg-white'
  const selectCls = inputCls + ' cursor-pointer'

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">設定排程</h3>
          <p className="text-xs text-gray-500 mt-0.5">應用程式運行期間自動按時執行此 Pipeline</p>
        </div>

        <div className="p-5 space-y-4">
          {/* 名稱 */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1.5">排程名稱</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
              placeholder="輸入排程名稱"
            />
          </div>

          {/* 模式選擇 */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-2">執行方式</label>
            <div className="grid grid-cols-4 gap-1.5">
              {(['once', 'daily', 'weekly', 'custom'] as ScheduleMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'py-2 rounded-xl text-xs font-medium border transition-all',
                    mode === m
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  )}
                >
                  {m === 'once' ? '單次' : m === 'daily' ? '每天' : m === 'weekly' ? '每週' : '自訂'}
                </button>
              ))}
            </div>
          </div>

          {/* 單次：日期 + 時間 */}
          {mode === 'once' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1.5">日期</label>
                <input
                  type="date"
                  value={onceDate}
                  min={todayStr}
                  onChange={e => setOnceDate(e.target.value)}
                  className={`w-full ${inputCls}`}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1.5">時間</label>
                <div className="flex items-center gap-2">
                  <select value={onceHour} onChange={e => setOnceHour(e.target.value)} className={selectCls}>
                    {HOURS.map(h => <option key={h} value={h}>{h} 時</option>)}
                  </select>
                  <span className="text-gray-400 font-bold">:</span>
                  <select value={onceMin} onChange={e => setOnceMin(e.target.value)} className={selectCls}>
                    {MINS.map(m => <option key={m} value={m}>{m} 分</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* 每天：小時 + 分鐘 */}
          {mode === 'daily' && (
            <div>
              <label className="text-xs text-gray-500 block mb-1.5">每天幾點幾分執行</label>
              <div className="flex items-center gap-2">
                <select value={dailyHour} onChange={e => setDailyHour(e.target.value)} className={selectCls}>
                  {HOURS.map(h => <option key={h} value={h}>{h} 時</option>)}
                </select>
                <span className="text-gray-400 font-bold">:</span>
                <select value={dailyMin} onChange={e => setDailyMin(e.target.value)} className={selectCls}>
                  {MINS.map(m => <option key={m} value={m}>{m} 分</option>)}
                </select>
              </div>
            </div>
          )}

          {/* 每週：星期 + 時間 */}
          {mode === 'weekly' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1.5">星期幾</label>
                <div className="grid grid-cols-7 gap-1">
                  {WEEK_DAYS.map((d, i) => (
                    <button
                      key={i}
                      onClick={() => setWeekDay(String(i))}
                      className={cn(
                        'py-1.5 rounded-lg text-xs font-medium border transition-all',
                        weekDay === String(i)
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1.5">幾點幾分</label>
                <div className="flex items-center gap-2">
                  <select value={weekHour} onChange={e => setWeekHour(e.target.value)} className={selectCls}>
                    {HOURS.map(h => <option key={h} value={h}>{h} 時</option>)}
                  </select>
                  <span className="text-gray-400 font-bold">:</span>
                  <select value={weekMin} onChange={e => setWeekMin(e.target.value)} className={selectCls}>
                    {MINS.map(m => <option key={m} value={m}>{m} 分</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* 自訂 Cron */}
          {mode === 'custom' && (
            <div className="space-y-2">
              <label className="text-xs text-gray-500 block">Cron 表達式</label>
              <input
                value={customCron}
                onChange={e => setCustomCron(e.target.value)}
                className={`w-full font-mono ${inputCls}`}
                placeholder="分 時 日 月 星期"
              />
              <p className="text-xs text-gray-400">
                格式：<code>分(0-59) 時(0-23) 日(1-31) 月(1-12) 星期(0-7)</code><br />
                例：<code>0 9 * * 1-5</code> = 週一至週五早上 9 點
              </p>
            </div>
          )}

          {/* 預覽 */}
          <div className="bg-brand-50 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-brand-500 shrink-0" />
            <div>
              <p className="text-xs text-brand-700 font-medium">{schedule.label}</p>
              <p className="text-xs text-brand-500 font-mono mt-0.5">{schedule.type === 'once' ? schedule.expr : `cron: ${schedule.expr}`}</p>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-100 transition-colors">
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-60"
          >
            <CalendarClock className="w-3.5 h-3.5" />
            {saving ? '建立中...' : '建立排程'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Scheduled Tasks Panel ──────────────────────────────────
function ScheduledPanel() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await getPipelineScheduled()
      setTasks(data)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`確定刪除排程「${name}」？`)) return
    try {
      await deletePipelineSchedule(id)
      toast.success('排程已刪除')
      load()
    } catch { toast.error('刪除失敗') }
  }

  if (loading) return <div className="py-8 text-center text-sm text-gray-400">載入中...</div>
  if (tasks.length === 0) return (
    <div className="py-8 text-center text-sm text-gray-400">
      尚無排程。在 YAML 編輯器下方點「設定排程」可新增。
    </div>
  )

  return (
    <div className="space-y-2">
      {tasks.map(task => (
        <div key={task.id} className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-xl">
          <CalendarClock className="w-4 h-4 text-brand-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-800 truncate">{task.name}</div>
            <div className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
              <code className="font-mono">{task.schedule_expr}</code>
              {task.next_run && <span>· 下次：{new Date(task.next_run).toLocaleString('zh-TW')}</span>}
              {task.last_run && <span>· 上次：{new Date(task.last_run).toLocaleString('zh-TW')}</span>}
            </div>
          </div>
          <button
            onClick={() => handleDelete(task.id, task.name)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Visual Builder Types & Helpers ─────────────────────────
interface StepDraft {
  id: string
  name: string
  batch: string
  outputPath: string
  outputExpect: string
  timeout: number
  retry: number
}

function newStep(index: number): StepDraft {
  return { id: Math.random().toString(36).slice(2), name: `步驟 ${index + 1}`, batch: '', outputPath: '', outputExpect: '', timeout: 300, retry: 0 }
}

function stepsToYaml(pipelineName: string, steps: StepDraft[]): string {
  const stepLines = steps.map(s => {
    const lines = [`    - name: ${s.name || '未命名'}`, `      batch: ${s.batch || '# 填入執行命令'}`, `      timeout: ${s.timeout}`, `      retry: ${s.retry}`]
    if (s.outputPath) {
      lines.push(`      output:`, `        path: ${s.outputPath}`)
      if (s.outputExpect) lines.push(`        expect: "${s.outputExpect}"`)
    }
    return lines.join('\n')
  })
  return `pipeline:\n  name: ${pipelineName || 'My Pipeline'}\n\n  steps:\n${stepLines.join('\n\n')}\n`
}

function parseYamlToFlow(yaml: string): { name: string; steps: StepDraft[] } | null {
  try {
    const lines = yaml.split('\n')
    let name = 'My Pipeline'
    const steps: StepDraft[] = []
    let cur: Partial<StepDraft> | null = null
    let inOutput = false

    const push = () => {
      if (cur) steps.push({ id: Math.random().toString(36).slice(2), name: cur.name || '', batch: cur.batch || '', outputPath: cur.outputPath || '', outputExpect: cur.outputExpect || '', timeout: cur.timeout ?? 300, retry: cur.retry ?? 0 })
    }

    for (const raw of lines) {
      const m = (re: RegExp) => raw.match(re)
      if (!cur && m(/^  name:\s+(.+)$/)) { name = m(/^  name:\s+(.+)$/)![1].trim(); continue }
      if (m(/^    - name:\s+(.+)$/)) { push(); cur = { name: m(/^    - name:\s+(.+)$/)![1].trim() }; inOutput = false; continue }
      if (!cur) continue
      if (m(/^      batch:\s*(.*)/)) { cur.batch = m(/^      batch:\s*(.*)/)![1].trim(); continue }
      if (m(/^      timeout:\s*(\d+)/)) { cur.timeout = parseInt(m(/^      timeout:\s*(\d+)/)![1]); continue }
      if (m(/^      retry:\s*(\d+)/)) { cur.retry = parseInt(m(/^      retry:\s*(\d+)/)![1]); continue }
      if (m(/^      output:/)) { inOutput = true; continue }
      if (inOutput && m(/^        path:\s+(.+)/)) { cur.outputPath = m(/^        path:\s+(.+)/)![1].trim(); continue }
      if (inOutput && m(/^        expect:\s+"?(.+?)"?\s*$/)) { cur.outputExpect = m(/^        expect:\s+"?(.+?)"?\s*$/)![1].trim(); continue }
    }
    push()
    return steps.length > 0 ? { name, steps } : null
  } catch { return null }
}

// ── File Browser Modal ──────────────────────────────────────
function FileBrowserModal({ onSelect, onClose }: {
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const [data, setData] = useState<{ path: string; parent: string | null; items: { name: string; path: string; is_dir: boolean; ext: string }[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [manualPath, setManualPath] = useState('')

  const load = useCallback(async (path = '') => {
    setLoading(true)
    try {
      const res = await fsBrowse(path)
      setData(res)
      setManualPath(res.path)
    } catch { toast.error('無法瀏覽此路徑') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const pathParts = data?.path.split('/').filter(Boolean) ?? []

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[70vh]">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 shrink-0">
          <FolderOpen className="w-4 h-4 text-brand-500" />
          <span className="text-sm font-medium text-gray-900">選擇路徑</span>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        {/* Breadcrumb */}
        <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-1 text-xs text-gray-500 flex-wrap shrink-0">
          <button onClick={() => load('')} className="hover:text-brand-600">~</button>
          {pathParts.slice(2).map((part, i) => (
            <span key={i} className="flex items-center gap-1">
              <span>/</span>
              <button onClick={() => load('/' + pathParts.slice(0, i + 3).join('/'))} className="hover:text-brand-600">{part}</button>
            </span>
          ))}
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">載入中...</div>
          ) : (
            <>
              {data?.parent && (
                <button onClick={() => load(data.parent!)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm text-gray-500">
                  <span>📁</span> ..（上一層）
                </button>
              )}
              {data?.items.map(item => (
                <button
                  key={item.path}
                  onClick={() => item.is_dir ? load(item.path) : onSelect(item.path)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm text-left',
                    item.is_dir ? 'text-gray-700' : 'text-gray-600'
                  )}
                >
                  <span>{item.is_dir ? '📁' : item.ext === '.py' ? '🐍' : item.ext === '.sh' ? '⚙️' : '📄'}</span>
                  <span className="flex-1 truncate">{item.name}</span>
                  {!item.is_dir && <span className="text-xs text-gray-300 shrink-0">{item.ext}</span>}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Manual path + select current dir */}
        <div className="p-3 border-t border-gray-100 space-y-2 shrink-0">
          <div className="flex gap-2">
            <input
              value={manualPath}
              onChange={e => setManualPath(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load(manualPath)}
              placeholder="手動輸入路徑..."
              className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none focus:border-brand-400"
            />
            <button onClick={() => load(manualPath)} className="px-3 py-1.5 text-xs rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700">前往</button>
          </div>
          <button
            onClick={() => onSelect(data?.path ?? '')}
            className="w-full py-2 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            選擇此目錄：{data?.path}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 常用執行前綴 ─────────────────────────────────────────────
const EXEC_PREFIXES = [
  // ── macOS / Linux ──────────────────────────────
  { label: 'python3 (macOS/Linux)',    value: 'python3' },
  { label: 'python (macOS/Linux)',     value: 'python' },
  { label: '.venv/bin/python (venv)',  value: '.venv/bin/python' },
  { label: 'bash',                     value: 'bash' },
  { label: 'sh',                       value: 'sh' },
  // ── Windows ────────────────────────────────────
  { label: 'py (Windows Launcher)',    value: 'py' },
  { label: 'py -3 (Windows Py3)',      value: 'py -3' },
  { label: 'python (Windows)',         value: 'python' },
  { label: '.venv\\Scripts\\python (Windows venv)', value: '.venv\\Scripts\\python' },
  // ── Node ───────────────────────────────────────
  { label: 'node',                     value: 'node' },
  { label: 'npx',                      value: 'npx' },
  // ── 其他 ───────────────────────────────────────
  { label: '直接執行（不加前綴）',      value: '' },
]

/** 從 batch 指令中偵測前綴，回傳 prefix 和剩餘路徑 */
function splitBatch(batch: string): { prefix: string; filePath: string } {
  // 依長度由長到短排序，避免 "python" 比 "python3" 先匹配
  const sorted = [...EXEC_PREFIXES].sort((a, b) => b.value.length - a.value.length)
  for (const p of sorted) {
    if (p.value && batch.startsWith(p.value + ' ')) {
      return { prefix: p.value, filePath: batch.slice(p.value.length + 1).trim() }
    }
  }
  return { prefix: '', filePath: batch }
}

// ── Step Card ───────────────────────────────────────────────
function StepCard({ step, index, total, onChange, onDelete, onMoveUp, onMoveDown }: {
  step: StepDraft
  index: number
  total: number
  onChange: (s: StepDraft) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [browserTarget, setBrowserTarget] = useState<'batch' | 'output' | null>(null)
  const [venvChecking, setVenvChecking] = useState(false)

  // 前綴下拉：從現有 batch 指令偵測初始值
  const [selectedPrefix, setSelectedPrefix] = useState<string>(
    () => splitBatch(step.batch).prefix || 'python3'
  )

  const upd = (patch: Partial<StepDraft>) => onChange({ ...step, ...patch })
  const inputCls = 'w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-500/20 bg-white font-mono'

  // 從 batch 指令中解出 .py 腳本路徑
  const extractPyPath = (batch: string): string | null => {
    const m = batch.match(/(?:\.venv\/bin\/python\S*|python\S*)\s+(\S+\.py)/) || batch.match(/^(\S+\.py)$/)
    return m ? m[1] : null
  }

  const pyPath = extractPyPath(step.batch)
  const isUsingVenv = step.batch.includes('.venv/bin/python')

  const handleVenvToggle = async (checked: boolean) => {
    if (!pyPath) return
    const scriptDir = pyPath.substring(0, pyPath.lastIndexOf('/'))

    if (!checked) {
      // 取消 venv：改回 python3
      upd({ batch: `python3 ${pyPath}` })
      return
    }

    setVenvChecking(true)
    try {
      const res = await fsCheckVenv(scriptDir)
      if (res.has_venv && res.python_path) {
        upd({ batch: `${res.python_path} ${pyPath}` })
        toast.success('已切換為虛擬環境 Python')
      } else {
        toast.error(
          `找不到 .venv，請先在專案目錄執行：\ncd ${scriptDir} && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`,
          { duration: 8000 }
        )
      }
    } catch {
      toast.error('檢查虛擬環境失敗')
    } finally {
      setVenvChecking(false)
    }
  }

  return (
    <>
      {browserTarget && (
        <FileBrowserModal
          onSelect={path => {
            if (browserTarget === 'batch') {
              // 根據副檔名自動切換前綴
              let prefix = selectedPrefix
              if (path.endsWith('.sh')) {
                prefix = 'bash'; setSelectedPrefix('bash')
              } else if (path.endsWith('.js') || path.endsWith('.mjs')) {
                prefix = 'node'; setSelectedPrefix('node')
              } else if (path.endsWith('.py') && !prefix) {
                prefix = 'python3'; setSelectedPrefix('python3')
              }
              upd({ batch: prefix ? `${prefix} ${path}` : path })
            } else {
              upd({ outputPath: path })
            }
            setBrowserTarget(null)
          }}
          onClose={() => setBrowserTarget(null)}
        />
      )}

      <div className="bg-white border-2 border-gray-100 rounded-2xl overflow-hidden shadow-sm hover:border-brand-200 transition-colors">
        {/* Card header */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-brand-50 to-transparent border-b border-gray-100">
          <div className="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{index + 1}</div>
          <input
            value={step.name}
            onChange={e => upd({ name: e.target.value })}
            placeholder="步驟名稱"
            className="flex-1 bg-transparent font-medium text-gray-900 text-sm outline-none placeholder-gray-400 min-w-0"
          />
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={onMoveUp} disabled={index === 0} className="p-1 rounded text-gray-300 hover:text-gray-500 disabled:opacity-20"><MoveUp className="w-3.5 h-3.5" /></button>
            <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 rounded text-gray-300 hover:text-gray-500 disabled:opacity-20"><MoveDown className="w-3.5 h-3.5" /></button>
            <button onClick={onDelete} className="p-1 rounded text-gray-300 hover:text-red-400 ml-1"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>

        {/* Card body */}
        <div className="p-4 space-y-3">
          {/* Batch command */}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">執行指令</label>
            {/* 前綴選單 */}
            <div className="flex gap-1.5 mb-1.5">
              <select
                value={selectedPrefix}
                onChange={e => {
                  const newPrefix = e.target.value
                  setSelectedPrefix(newPrefix)
                  const { filePath } = splitBatch(step.batch)
                  if (filePath) upd({ batch: newPrefix ? `${newPrefix} ${filePath}` : filePath })
                }}
                className="shrink-0 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white text-gray-700 outline-none focus:border-brand-400 cursor-pointer"
              >
                {EXEC_PREFIXES.map((p, i) => (
                  <option key={i} value={p.value}>{p.label}</option>
                ))}
              </select>
              <span className="text-gray-300 text-xs self-center">+</span>
              <input
                value={splitBatch(step.batch).filePath}
                onChange={e => {
                  const fp = e.target.value
                  upd({ batch: selectedPrefix ? `${selectedPrefix} ${fp}` : fp })
                }}
                placeholder="選擇或輸入執行路徑"
                className={inputCls}
              />
              <button onClick={() => setBrowserTarget('batch')} title="瀏覽檔案" className="shrink-0 w-8 h-8 flex items-center justify-center border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-brand-600 transition-colors">
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>
            {/* 最終指令預覽 */}
            {step.batch && (
              <div className="text-xs text-gray-400 font-mono bg-gray-50 rounded px-2 py-1 truncate">
                ▶ {step.batch}
              </div>
            )}
            {/* venv toggle — 僅在選了 .py 腳本時顯示 */}
            {pyPath && (
              <label className={cn(
                'mt-2 flex items-center gap-2 text-xs cursor-pointer select-none w-fit px-2.5 py-1.5 rounded-lg border transition-colors',
                isUsingVenv
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              )}>
                <input
                  type="checkbox"
                  checked={isUsingVenv}
                  onChange={e => handleVenvToggle(e.target.checked)}
                  disabled={venvChecking}
                  className="w-3.5 h-3.5 accent-green-600"
                />
                {venvChecking ? '偵測中...' : isUsingVenv ? '✓ 使用 .venv 虛擬環境' : '使用 .venv 虛擬環境'}
              </label>
            )}
          </div>

          {/* Output path */}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">輸出路徑 <span className="text-gray-300 font-normal">（選填，用於驗證）</span></label>
            <div className="flex gap-1.5">
              <input value={step.outputPath} onChange={e => upd({ outputPath: e.target.value })} placeholder="~/output/file.csv 或目錄路徑" className={inputCls} />
              <button onClick={() => setBrowserTarget('output')} title="瀏覽路徑" className="shrink-0 w-8 h-8 flex items-center justify-center border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-brand-600 transition-colors">
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Advanced toggle */}
          <button onClick={() => setShowAdvanced(v => !v)} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
            <Settings2 className="w-3.5 h-3.5" />
            進階設定（timeout / retry / expect）
            <ChevronDown className={cn('w-3 h-3 transition-transform', showAdvanced && 'rotate-180')} />
          </button>

          {showAdvanced && (
            <div className="space-y-2.5 pt-1 border-t border-gray-100">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Timeout（秒）</label>
                  <input type="number" value={step.timeout} onChange={e => upd({ timeout: parseInt(e.target.value) || 300 })} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">自動重試次數</label>
                  <input type="number" min={0} max={5} value={step.retry} onChange={e => upd({ retry: parseInt(e.target.value) || 0 })} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">輸出期望描述 <span className="text-gray-300">（給 AI 驗證用）</span></label>
                <input value={step.outputExpect} onChange={e => upd({ outputExpect: e.target.value })} placeholder="例：CSV 檔案，不為空，包含正確欄位" className={inputCls} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Pipeline Flow Builder ───────────────────────────────────
function PipelineFlowBuilder({ name, steps, onChange }: {
  name: string
  steps: StepDraft[]
  onChange: (name: string, steps: StepDraft[]) => void
}) {
  const updStep = (i: number, s: StepDraft) => { const ns = [...steps]; ns[i] = s; onChange(name, ns) }
  const delStep = (i: number) => { const ns = steps.filter((_, idx) => idx !== i); onChange(name, ns) }
  const moveUp = (i: number) => { if (i === 0) return; const ns = [...steps]; [ns[i-1], ns[i]] = [ns[i], ns[i-1]]; onChange(name, ns) }
  const moveDown = (i: number) => { if (i === steps.length - 1) return; const ns = [...steps]; [ns[i], ns[i+1]] = [ns[i+1], ns[i]]; onChange(name, ns) }
  const addStep = () => onChange(name, [...steps, newStep(steps.length)])

  return (
    <div className="space-y-0">
      {/* Pipeline name */}
      <div className="mb-4">
        <label className="text-xs font-medium text-gray-500 block mb-1.5">流程名稱</label>
        <input
          value={name}
          onChange={e => onChange(e.target.value, steps)}
          placeholder="我的自動化流程"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-gray-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
        />
      </div>

      {/* Steps */}
      {steps.map((step, i) => (
        <div key={step.id}>
          <StepCard
            step={step} index={i} total={steps.length}
            onChange={s => updStep(i, s)}
            onDelete={() => delStep(i)}
            onMoveUp={() => moveUp(i)}
            onMoveDown={() => moveDown(i)}
          />
          {i < steps.length - 1 && (
            <div className="flex flex-col items-center py-1">
              <div className="w-0.5 h-4 bg-brand-200" />
              <ArrowDown className="w-4 h-4 text-brand-300 -mt-0.5" />
            </div>
          )}
        </div>
      ))}

      {/* Add step */}
      <div className={steps.length > 0 ? 'flex flex-col items-center pt-1' : ''}>
        {steps.length > 0 && (
          <>
            <div className="w-0.5 h-4 bg-brand-200" />
            <ArrowDown className="w-4 h-4 text-brand-300 -mt-0.5 mb-1" />
          </>
        )}
        <button
          onClick={addStep}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-brand-200 text-brand-500 hover:border-brand-400 hover:bg-brand-50 transition-all text-sm font-medium w-full justify-center"
        >
          <Plus className="w-4 h-4" />
          新增步驟
        </button>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────
export default function PipelinePage() {
  const [runs, setRuns] = useState<PipelineRun[]>([])
  const [loading, setLoading] = useState(true)
  const [yamlContent, setYamlContent] = useState(EXAMPLE_YAML)
  const [launching, setLaunching] = useState(false)
  const [activeTab, setActiveTab] = useState<'runs' | 'scheduled'>('runs')
  const [showEditor, setShowEditor] = useState(false)
  const [showScheduleDialog, setShowScheduleDialog] = useState(false)
  const [scheduledCount, setScheduledCount] = useState(0)
  const [validateLLM, setValidateLLM] = useState(true)
  // Visual builder
  const [editorTab, setEditorTab] = useState<'visual' | 'yaml'>('visual')
  const [flowName, setFlowName] = useState('我的自動化流程')
  const [flowSteps, setFlowSteps] = useState<StepDraft[]>([newStep(0)])

  const loadRuns = useCallback(async () => {
    try {
      const data = await getPipelineRuns()
      setRuns(data)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  const loadScheduledCount = useCallback(async () => {
    try {
      const tasks = await getPipelineScheduled()
      setScheduledCount(tasks.length)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    loadRuns()
    loadScheduledCount()
    const interval = setInterval(loadRuns, 5000)
    return () => clearInterval(interval)
  }, [loadRuns, loadScheduledCount])

  const handleLaunch = async () => {
    setLaunching(true)
    try {
      const res = await startPipeline(yamlContent, validateLLM)
      toast.success(`Pipeline 已啟動！(${res.run_id})`)
      setShowEditor(false)
      setActiveTab('runs')
      setTimeout(loadRuns, 500)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '啟動失敗')
    } finally {
      setLaunching(false)
    }
  }

  const handleYamlReady = (yaml: string) => {
    setYamlContent(yaml)
    const parsed = parseYamlToFlow(yaml)
    if (parsed) { setFlowName(parsed.name); setFlowSteps(parsed.steps) }
    setEditorTab('visual')
    setShowEditor(true)
  }

  const handleFlowChange = (name: string, steps: StepDraft[]) => {
    setFlowName(name); setFlowSteps(steps)
    setYamlContent(stepsToYaml(name, steps))
  }

  const handleSwitchTab = (tab: 'visual' | 'yaml') => {
    if (tab === 'visual') {
      const parsed = parseYamlToFlow(yamlContent)
      if (parsed) { setFlowName(parsed.name); setFlowSteps(parsed.steps) }
    }
    setEditorTab(tab)
  }

  // Extract pipeline name from YAML
  const getPipelineName = () => {
    const match = yamlContent.match(/name:\s*(.+)/)
    return match ? match[1].trim() : 'Pipeline 排程'
  }

  const awaitingCount = runs.filter(r => r.status === 'awaiting_human').length

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: AI Assistant */}
      <div className="w-96 shrink-0 flex flex-col overflow-hidden">
        <YamlAssistant onYamlReady={handleYamlReady} />
      </div>

      {/* Right: Editor + Run list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab bar */}
        <div className="h-14 border-b border-gray-200 flex items-center justify-between px-5 shrink-0">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('runs')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                activeTab === 'runs' ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:text-gray-700'
              )}
            >
              執行紀錄
              {awaitingCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">{awaitingCount}</span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('scheduled')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                activeTab === 'scheduled' ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:text-gray-700'
              )}
            >
              排程管理
              {scheduledCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs bg-brand-100 text-brand-700">{scheduledCount}</span>
              )}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadRuns} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowEditor(v => !v)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition-all',
                showEditor ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
              )}
            >
              <Play className="w-3.5 h-3.5" />
              {showEditor ? '收起編輯器' : '新增 Pipeline'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Pipeline Editor */}
          {showEditor && (
            <div className="border border-brand-200 rounded-2xl overflow-hidden bg-white shadow-sm">
              {/* Editor tab bar */}
              <div className="flex items-center border-b border-brand-100 bg-brand-50 px-3 pt-2.5 gap-1">
                <button
                  onClick={() => handleSwitchTab('visual')}
                  className={cn('flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium border-b-2 transition-all -mb-px',
                    editorTab === 'visual' ? 'border-brand-600 text-brand-700 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700')}
                >
                  <Layers className="w-3.5 h-3.5" />
                  視覺化設計
                </button>
                <button
                  onClick={() => handleSwitchTab('yaml')}
                  className={cn('flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium border-b-2 transition-all -mb-px',
                    editorTab === 'yaml' ? 'border-brand-600 text-brand-700 bg-white' : 'border-transparent text-gray-500 hover:text-gray-700')}
                >
                  <Code2 className="w-3.5 h-3.5" />
                  YAML 編輯
                </button>
                <span className="ml-auto text-xs text-brand-400 pb-2">兩者即時同步</span>
              </div>

              {/* Visual builder */}
              {editorTab === 'visual' && (
                <div className="p-5 overflow-y-auto max-h-[60vh]">
                  <PipelineFlowBuilder name={flowName} steps={flowSteps} onChange={handleFlowChange} />
                </div>
              )}

              {/* YAML editor */}
              {editorTab === 'yaml' && (
                <textarea
                  value={yamlContent}
                  onChange={e => setYamlContent(e.target.value)}
                  rows={18}
                  className="w-full p-4 font-mono text-xs bg-gray-950 text-green-300 outline-none resize-none"
                  spellCheck={false}
                />
              )}

              {/* Toolbar */}
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center gap-3">
                <button
                  onClick={() => setShowScheduleDialog(true)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-brand-200 text-brand-600 hover:bg-brand-50 transition-colors"
                >
                  <CalendarPlus className="w-3.5 h-3.5" />
                  設定排程
                </button>
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none ml-auto mr-3">
                  <input
                    type="checkbox"
                    checked={validateLLM}
                    onChange={e => setValidateLLM(e.target.checked)}
                    className="w-3.5 h-3.5 accent-brand-600"
                  />
                  AI 驗證輸出
                </label>
                <button
                  onClick={handleLaunch}
                  disabled={launching}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-60"
                >
                  <Play className="w-3.5 h-3.5" />
                  {launching ? '啟動中...' : '立即執行'}
                </button>
              </div>
            </div>
          )}

          {/* Tab content */}
          {activeTab === 'runs' && (
            loading ? (
              <div className="flex items-center justify-center py-20 text-gray-400 text-sm">載入中...</div>
            ) : runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                  <Play className="w-7 h-7 text-gray-400" />
                </div>
                <h2 className="text-base font-medium text-gray-700 mb-1">尚無執行紀錄</h2>
                <p className="text-sm text-gray-500">在左側和 AI 助手對話，生成 YAML 後點「立即執行」開始</p>
              </div>
            ) : (
              <div className="space-y-3">
                {runs.map(run => (
                  <RunCard
                    key={run.run_id}
                    run={run}
                    onRefresh={loadRuns}
                    onEdit={(yaml) => { setYamlContent(yaml); setShowEditor(true) }}
                  />
                ))}
              </div>
            )
          )}

          {activeTab === 'scheduled' && <ScheduledPanel />}
        </div>
      </div>

      {/* Schedule Dialog */}
      {showScheduleDialog && (
        <ScheduleDialog
          yamlContent={yamlContent}
          pipelineName={getPipelineName()}
          validateLLM={validateLLM}
          onClose={() => setShowScheduleDialog(false)}
          onCreated={() => {
            loadScheduledCount()
            setActiveTab('scheduled')
          }}
        />
      )}
    </div>
  )
}
