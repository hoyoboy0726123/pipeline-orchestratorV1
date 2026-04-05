'use client'
import { useState, useRef, useEffect } from 'react'
import {
  Plus, Workflow, X, Bot, ChevronUp, ChevronDown,
  Send, Loader2, Pencil, Check, Trash2, Settings, BookOpen,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import { useWorkflowStore } from './_store'
import { pipelineChat } from '@/lib/api'

// ── AI Chat Message Type ─────────────────────────────────────────────────────
interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  hasYaml?: boolean
  yaml?: string | null
}

// ── Workflow List Item ───────────────────────────────────────────────────────
function WorkflowItem({
  id, name, active, updatedAt,
  onSelect, onRename, onDelete,
}: {
  id: string; name: string; active: boolean; updatedAt: number
  onSelect: () => void
  onRename: (n: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])
  useEffect(() => { setDraft(name) }, [name])

  const commit = () => { onRename(draft.trim() || name); setEditing(false) }

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
        <p className="text-xs text-gray-400 mt-0.5">{relTime}</p>
      </div>
      {/* Action buttons */}
      <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {!editing && (
          <button onClick={e => { e.stopPropagation(); setEditing(true) }}
            className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600">
            <Pencil className="w-3 h-3" />
          </button>
        )}
        {editing && (
          <button onClick={e => { e.stopPropagation(); commit() }}
            className="p-1 rounded hover:bg-green-100 text-green-500">
            <Check className="w-3 h-3" />
          </button>
        )}
        <button onClick={e => { e.stopPropagation(); onDelete() }}
          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
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
    { role: 'assistant', content: '你好！請告訴我你想自動化的工作流程，我會幫你產生 Pipeline YAML 設定。\n\n例如：「每天早上 9 點抓取財務報表，清洗資料後生成 Excel」' }
  ])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // 自動滾到底部
  useEffect(() => {
    if (showChat) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, showChat])

  // 初始化：Zustand persist 水化完成後，若仍無工作流才建立
  useEffect(() => {
    const unsub = useWorkflowStore.persist.onFinishHydration(() => {
      if (useWorkflowStore.getState().workflows.length === 0) {
        createWorkflow('我的第一個工作流')
      }
    })
    // 若已經水化完成（重新整理後），直接檢查
    if (useWorkflowStore.persist.hasHydrated() && useWorkflowStore.getState().workflows.length === 0) {
      createWorkflow('我的第一個工作流')
    }
    return unsub
  }, []) // eslint-disable-line

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`確定刪除「${name}」？`)) return
    removeWorkflow(id)
    if (workflows.length <= 1) {
      createWorkflow('新工作流')
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

      {/* ── New Workflow Button ── */}
      <div className="px-3 pt-3 pb-2">
        <button
          onClick={() => createWorkflow('新工作流')}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          新增工作流
        </button>
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
            onSelect={() => setActive(wf.id)}
            onRename={name => updateWorkflow(wf.id, { name })}
            onDelete={() => handleDelete(wf.id, wf.name)}
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
                  <div className={`max-w-[88%] rounded-xl px-2.5 py-1.5 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-gray-100 text-gray-700 rounded-bl-sm'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-xs max-w-none prose-p:my-0.5 prose-pre:text-xs">
                        <ReactMarkdown>{msg.content.replace(/YAML_READY\n```yaml[\s\S]*?```/g, '（已偵測到 YAML ↓）')}</ReactMarkdown>
                      </div>
                    ) : (
                      msg.content
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
            <div className="p-2 border-t border-gray-100 flex gap-1.5">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder="描述你的工作流…"
                disabled={loading}
                className="flex-1 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs outline-none focus:border-indigo-400 transition-colors disabled:bg-gray-50"
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
