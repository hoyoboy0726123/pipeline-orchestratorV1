'use client'
import { useState, useRef, useEffect } from 'react'
import {
  Plus, Workflow, X, Bot, ChevronUp, ChevronDown,
  Send, Loader2, Pencil, Check, Trash2, Settings, BookOpen,
  Download, Upload, Square,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import { useWorkflowStore } from './_store'
import { 
  pipelineChat, createWorkflowApi, exportWorkflowUrl, importWorkflow, 
  getPipelineScheduled, getPipelineRuns, cancelPipelineSchedule 
} from '@/lib/api'
import type { ScheduledTask } from '@/lib/types'

// ── AI Chat Message Type ─────────────────────────────────────────────────────
interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  hasYaml?: boolean
  yaml?: string | null
}

// ── Countdown Hook ──────────────────────────────────────────────────────────
function useCountdown(nextRun: string | null) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (!nextRun) { setText(''); return }
    const calc = () => {
      // 解析日期並檢查有效性
      const targetDate = new Date(nextRun)
      const now = new Date()
      
      if (isNaN(targetDate.getTime())) { 
        setText('')
        return 
      }
      
      let diff = targetDate.getTime() - now.getTime()
      
      // 如果 diff 為負但絕對值很小（10秒內），視為即將執行
      if (diff <= 0) {
        if (diff > -10000) setText('即將執行…')
        else setText('') 
        return
      }
      
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      
      if (h > 24) setText('1天以上')
      else if (h > 0) setText(`${h}時${m}分後執行`)
      else if (m > 0) setText(`${m}分${s}秒後執行`)
      else setText(`${s}秒後執行`)
    }
    calc()
    const iv = setInterval(calc, 1000)
    return () => clearInterval(iv)
  }, [nextRun])
  return text
}

// ── Workflow List Item ───────────────────────────────────────────────────────
function WorkflowItem({
  id, name, active, updatedAt, nextRun, runStatus,
  onSelect, onRename, onDelete, onExport,
}: {
  id: string; name: string; active: boolean; updatedAt: number; nextRun: string | null
  runStatus: 'idle' | 'running' | 'completed' | 'failed' | null
  onSelect: () => void
  onRename: (n: string) => void
  onDelete: () => void
  onExport: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])
  useEffect(() => { setDraft(name) }, [name])

  const commit = () => { onRename(draft.trim() || name); setEditing(false) }

  const countdown = useCountdown(nextRun)

  const relTime = (() => {
    const diff = Date.now() - updatedAt
    if (diff < 60000) return '剛才'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分鐘前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小時前`
    return new Date(updatedAt).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })
  })()

  return (
    <div
      onClick={() => { if (!editing) onSelect() }}
      className={`group relative flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
        active ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-gray-50 border border-transparent'
      }`}
    >
      <Workflow className={`w-4 h-4 shrink-0 ${active ? 'text-indigo-600' : 'text-gray-400'}`} />
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
            className="w-full text-sm font-medium text-gray-800 bg-transparent outline-none border-b border-indigo-400"
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <p className={`text-sm font-medium truncate ${active ? 'text-indigo-700' : 'text-gray-700'}`}>{name}</p>
        )}
        {runStatus === 'running' ? (
          <p className="text-xs text-indigo-500 font-medium mt-0.5 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            執行中…
          </p>
        ) : runStatus === 'completed' ? (
          <p className="text-xs text-emerald-500 font-medium mt-0.5">已完成</p>
        ) : runStatus === 'failed' ? (
          <p className="text-xs text-red-500 font-medium mt-0.5">執行失敗</p>
        ) : countdown ? (
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-amber-500 font-medium flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {countdown}
            </p>
            <button
              onClick={async (e) => {
                e.stopPropagation()
                if (confirm(`確定取消「${name}」的排程執行？`)) {
                  try {
                    await cancelPipelineSchedule(name)
                    toast.success('排程已取消')
                    // 這裡依賴 Sidebar 的 fetchSchedules 每 15 秒同步一次
                  } catch (err) {
                    toast.error('取消失敗')
                  }
                }
              }}
              className="p-0.5 rounded hover:bg-amber-100 text-amber-600 transition-colors"
              title="取消排程"
            >
              <Square className="w-2.5 h-2.5 fill-current" />
            </button>
          </div>
        ) : (
          <p className="text-xs text-gray-400 mt-0.5">{relTime}</p>
        )}
      </div>
      {/* Action buttons */}
      <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {!editing && (
          <>
            <button onClick={e => { e.stopPropagation(); setEditing(true) }}
              className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600" title="重新命名">
              <Pencil className="w-3 h-3" />
            </button>
            <button onClick={e => { e.stopPropagation(); onExport() }}
              className="p-1 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600" title="匯出">
              <Download className="w-3 h-3" />
            </button>
          </>
        )}
        {editing && (
          <button onClick={e => { e.stopPropagation(); commit() }}
            className="p-1 rounded hover:bg-green-100 text-green-500">
            <Check className="w-3 h-3" />
          </button>
        )}
        <button onClick={e => { e.stopPropagation(); onDelete() }}
          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500" title="刪除">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
interface SidebarProps {
  onYamlApply: (yaml: string) => void
}

export default function Sidebar({ onYamlApply }: SidebarProps) {
  const {
    workflows, activeId,
    createWorkflow, updateWorkflow, removeWorkflow, setActive,
  } = useWorkflowStore()

  const [showChat, setShowChat] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'assistant', content: '你好！請告訴我你想自動化的工作流程，我會幫你產生 Pipeline YAML 設定。\n\n**範例 1（AI 技能）**\n把 ~/data/report.xlsx（或上一步產生的資料）整理好，加上格線、自動換行，儲存到 ~/ai_output/formatted_report.xlsx\n\n**範例 2（Python 腳本串接）**\n第一步：執行 ~/scripts/fetch_data.py，輸出到 ~/ai_output/raw.csv\n第二步：執行 ~/scripts/analyze.py，讀取上一步的 csv，輸出到 ~/ai_output/result.xlsx' }
  ])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // 排程倒數：定期查詢排程並建立 name → nextRun 對應
  const [scheduleMap, setScheduleMap] = useState<Record<string, string>>({})
  useEffect(() => {
    const fetchSchedules = async () => {
      try {
        const tasks = await getPipelineScheduled()
        const map: Record<string, string> = {}
        for (const t of tasks) {
          if (t.next_run && t.name) map[t.name] = t.next_run
        }
        setScheduleMap(map)
      } catch { /* ignore */ }
    }
    fetchSchedules()
    const iv = setInterval(fetchSchedules, 15000)
    return () => clearInterval(iv)
  }, [])

  // 各工作流執行狀態：name → 'running' | 'completed' | 'failed'
  const [runStatusMap, setRunStatusMap] = useState<Record<string, 'running' | 'completed' | 'failed'>>({})
  useEffect(() => {
    const fetchRuns = async () => {
      try {
        const runs = await getPipelineRuns()
        const map: Record<string, 'running' | 'completed' | 'failed'> = {}
        const recentThreshold = 3 * 60 * 1000 // 完成/失敗狀態只顯示 3 分鐘
        for (const r of runs) {
          const name = r.pipeline_name
          if (r.status === 'running' || r.status === 'awaiting_human') {
            map[name] = 'running'
          } else if (!map[name] && r.ended_at) {
            const age = Date.now() - new Date(r.ended_at).getTime()
            if (age < recentThreshold) {
              if (r.status === 'completed') map[name] = 'completed'
              else if (r.status === 'failed' || r.status === 'aborted') map[name] = 'failed'
            }
          }
        }
        setRunStatusMap(map)
      } catch { /* ignore */ }
    }
    fetchRuns()
    const iv = setInterval(fetchRuns, 3000)
    return () => clearInterval(iv)
  }, [])

  // 自動滾到底部
  useEffect(() => {
    if (showChat) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, showChat])

  // 初始化：從 API 載入工作流，並遷移 localStorage 舊資料
  useEffect(() => {
    const init = async () => {
      // 1) 先嘗試遷移 localStorage 的工作流到後端
      const LS_KEY = 'pipeline-workflows-v1'
      try {
        const raw = localStorage.getItem(LS_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          const oldWorkflows: Array<{ id: string; name: string; nodes: any[]; edges: any[]; validate: boolean }> = parsed?.state?.workflows ?? []
          if (oldWorkflows.length > 0) {
            let migrated = 0
            for (const wf of oldWorkflows) {
              try {
                await createWorkflowApi(
                  wf.name,
                  { nodes: wf.nodes ?? [], edges: wf.edges ?? [] },
                  wf.validate ?? false,
                )
                migrated++
              } catch { /* 單筆失敗不中斷 */ }
            }
            if (migrated > 0) {
              toast.success(`已從瀏覽器遷移 ${migrated} 個工作流到資料庫`)
              // 只有成功遷移才清除 localStorage
              localStorage.removeItem(LS_KEY)
            }
          }
        }
      } catch { /* localStorage 讀取失敗不中斷 */ }

      // 2) 從 API 載入
      await useWorkflowStore.getState().fetchWorkflows()
      if (useWorkflowStore.getState().workflows.length === 0) {
        await createWorkflow('我的第一個工作流')
      }
    }
    init()
  }, []) // eslint-disable-line

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`確定刪除「${name}」？此操作會一併刪除相關的 Recipe 和執行紀錄。`)) return
    await removeWorkflow(id)
    if (useWorkflowStore.getState().workflows.length === 0) {
      await createWorkflow('新工作流')
    }
  }

  const handleExport = async (id: string) => {
    try {
      const res = await fetch(exportWorkflowUrl(id))
      if (!res.ok) throw new Error('匯出失敗')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disposition = res.headers.get('Content-Disposition')
      const match = disposition?.match(/filename\*=UTF-8''(.+)/)
      a.download = match ? decodeURIComponent(match[1]) : 'workflow.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      toast.error(err.message || '匯出失敗')
    }
  }

  const importRef = useRef<HTMLInputElement>(null)
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // 允許重複選同一檔案
    try {
      const res = await importWorkflow(file)
      await useWorkflowStore.getState().fetchWorkflows()
      useWorkflowStore.getState().setActive(res.workflow.id)
      let msg = `已匯入「${res.workflow.name}」`
      if (res.recipe_count > 0) msg += `，含 ${res.recipe_count} 個 Recipe`
      toast.success(msg)
      if (res.has_local_scripts) {
        toast.info('此工作流包含本地腳本步驟，請先確認相關腳本檔案已準備好才能執行', { duration: 6000 })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '匯入失敗')
    }
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return
    const userMsg: ChatMsg = { role: 'user', content: text }
    const newMsgs = [...messages, userMsg]
    setMessages(newMsgs)
    setInput('')
    setLoading(true)
    try {
      const res = await pipelineChat(
        newMsgs.map(m => ({ role: m.role, content: m.content }))
      )
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: res.reply,
          hasYaml: res.has_yaml,
          yaml: res.yaml_content,
        },
      ])
    } catch (e) {
      toast.error('AI 回應失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-64 shrink-0 h-full flex flex-col bg-white border-r border-gray-200 overflow-hidden">

      {/* ── Logo ── */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-gray-100">
        <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
          <Workflow className="w-4 h-4 text-white" />
        </div>
        <span className="font-bold text-gray-800 text-sm flex-1">Pipeline</span>
        <Link
          href="/recipes"
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          title="Recipe Book"
        >
          <BookOpen className="w-4 h-4" />
        </Link>
        <Link
          href="/settings"
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          title="設定"
        >
          <Settings className="w-4 h-4" />
        </Link>
      </div>

      {/* ── New / Import Workflow Buttons ── */}
      <div className="px-3 pt-3 pb-2 flex gap-1.5">
        <button
          onClick={() => { createWorkflow('新工作流') }}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-medium hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          新增
        </button>
        <button
          onClick={() => importRef.current?.click()}
          className="flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 rounded-xl text-xs font-medium hover:bg-gray-50 transition-colors"
          title="匯入工作流 (.zip)"
        >
          <Upload className="w-3.5 h-3.5" />
          匯入
        </button>
        <input ref={importRef} type="file" accept=".zip" className="hidden" onChange={handleImport} />
      </div>

      {/* ── Workflow List ── */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 min-h-0">
        {workflows.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-6">尚無工作流</p>
        )}
        {workflows.map(wf => (
          <WorkflowItem
            key={wf.id}
            id={wf.id}
            name={wf.name}
            active={wf.id === activeId}
            updatedAt={wf.updatedAt}
            nextRun={scheduleMap[wf.name] ?? null}
            runStatus={runStatusMap[wf.name] ?? null}
            onSelect={() => setActive(wf.id)}
            onRename={name => updateWorkflow(wf.id, { name })}
            onDelete={() => handleDelete(wf.id, wf.name)}
            onExport={() => handleExport(wf.id)}
          />
        ))}
      </div>

      {/* ── AI Assistant Section ── */}
      <div className="border-t border-gray-100 flex flex-col" style={{ maxHeight: showChat ? '360px' : undefined }}>
        {/* Toggle button */}
        <button
          onClick={() => setShowChat(!showChat)}
          className={`flex items-center gap-2 px-4 py-3 text-sm transition-colors ${
            showChat ? 'text-indigo-600 bg-indigo-50' : 'text-gray-600 hover:text-indigo-600 hover:bg-gray-50'
          }`}
        >
          <Bot className="w-4 h-4 shrink-0" />
          <span className="font-medium flex-1 text-left">AI 助手</span>
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />}
          {!loading && (showChat ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />)}
        </button>

        {/* Chat panel */}
        {showChat && (
          <div className="flex flex-col flex-1 min-h-0 border-t border-gray-100">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5" style={{ maxHeight: '240px' }}>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5 mr-1.5">
                      <Bot className="w-3 h-3 text-indigo-600" />
                    </div>
                  )}
                  <div className={`max-w-[88%] min-w-0 rounded-xl px-2.5 py-1.5 text-xs leading-relaxed break-words overflow-hidden ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-gray-100 text-gray-700 rounded-bl-sm'
                  }`} style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-xs max-w-none prose-p:my-0.5 prose-pre:text-xs prose-pre:whitespace-pre-wrap prose-code:break-all">
                        <ReactMarkdown>{msg.content.replace(/YAML_READY\n```yaml[\s\S]*?```/g, '（已偵測到 YAML ↓）')}</ReactMarkdown>
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}
                    {msg.hasYaml && msg.yaml && (
                      <button
                        onClick={() => {
                          onYamlApply(msg.yaml!)
                          toast.success('YAML 已套用到畫布')
                        }}
                        className="mt-1.5 w-full flex items-center justify-center gap-1 py-1 bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg text-xs font-medium transition-colors"
                      >
                        套用到畫布 →
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-xs text-gray-400 pl-7">
                  <Loader2 className="w-3 h-3 animate-spin" /> 思考中…
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="p-2 border-t border-gray-100 flex gap-1.5 items-end">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="描述你的工作流…（Enter 換行）"
                disabled={loading}
                rows={2}
                className="flex-1 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs outline-none focus:border-indigo-400 transition-colors disabled:bg-gray-50 resize-none"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="w-7 h-7 flex items-center justify-center bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors shrink-0"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
