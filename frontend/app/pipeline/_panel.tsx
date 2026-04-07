'use client'
import { useState, useEffect } from 'react'
import { X, FolderOpen, ChevronDown, ChevronUp } from 'lucide-react'
import type { PipelineNode, StepData } from './_helpers'
import { stepColor } from './_helpers'
import { fsBrowse, fsCheckVenv } from '@/lib/api'
import { toast } from 'sonner'

// ── 執行前綴 ─────────────────────────────────────────────────────────────────
const EXEC_PREFIXES = [
  // ── 跨平台 ──
  { label: 'python',                           value: 'python',                platform: 'cross' },
  { label: 'python3',                          value: 'python3',               platform: 'cross' },
  { label: 'node',                             value: 'node',                  platform: 'cross' },
  { label: 'npx',                              value: 'npx',                   platform: 'cross' },
  { label: '直接執行（不加前綴）',               value: '',                      platform: 'cross' },
  // ── macOS / Linux ──
  { label: '.venv/bin/python (venv)',          value: '.venv/bin/python',       platform: 'unix' },
  { label: 'bash',                             value: 'bash',                  platform: 'unix' },
  { label: 'sh',                               value: 'sh',                   platform: 'unix' },
  // ── Windows ──
  { label: 'py (Windows Launcher)',            value: 'py',                    platform: 'win' },
  { label: 'py -3 (Windows Py3)',              value: 'py -3',                 platform: 'win' },
  { label: '.venv\\Scripts\\python (Win venv)', value: '.venv\\Scripts\\python', platform: 'win' },
  { label: 'cmd /c',                           value: 'cmd /c',               platform: 'win' },
  { label: 'powershell -File',                 value: 'powershell -File',      platform: 'win' },
]

function splitBatch(batch: string): { prefix: string; filePath: string } {
  const sorted = [...EXEC_PREFIXES].sort((a, b) => b.value.length - a.value.length)
  for (const p of sorted) {
    if (p.value && batch.startsWith(p.value + ' '))
      return { prefix: p.value, filePath: batch.slice(p.value.length + 1).trim() }
  }
  return { prefix: '', filePath: batch }
}

// ── File Browser Modal ────────────────────────────────────────────────────────
interface BrowseItem { name: string; is_dir: boolean; path: string }

function FileBrowser({ onSelect, onClose }: { onSelect: (p: string) => void; onClose: () => void }) {
  const [currentPath, setCurrentPath] = useState('~')
  const [items, setItems] = useState<BrowseItem[]>([])
  const [loading, setLoading] = useState(false)
  const [manualPath, setManualPath] = useState('')

  const browse = async (p: string) => {
    setLoading(true)
    try {
      const data = await fsBrowse(p)
      setItems(data.items ?? [])
      setCurrentPath(data.path ?? p)
    } catch { toast.error('瀏覽失敗') }
    finally { setLoading(false) }
  }

  useEffect(() => { browse('~') }, [])

  const crumbs = currentPath.replace(/^\/Users\/[^/]+/, '~').split('/').filter(Boolean)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-h-[70vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm text-gray-700">選擇檔案</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 px-4 py-2 text-xs text-gray-500 flex-wrap border-b bg-gray-50">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-gray-300">/</span>}
              <button
                onClick={() => browse('/' + crumbs.slice(0, i + 1).join('/').replace(/^~/, `~`))}
                className="hover:text-indigo-600 transition-colors"
              >{c}</button>
            </span>
          ))}
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {loading && <p className="text-center text-gray-400 py-4 text-sm">載入中…</p>}
          {!loading && items.length === 0 && <p className="text-center text-gray-400 py-4 text-sm">（空目錄）</p>}
          {!loading && items.map(item => (
            <button
              key={item.path}
              onClick={() => item.is_dir ? browse(item.path) : onSelect(item.path)}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-indigo-50 text-left transition-colors"
            >
              <span className="text-base">{item.is_dir ? '📁' : '📄'}</span>
              <span className="text-sm text-gray-700 truncate flex-1">{item.name}</span>
              {item.is_dir && <span className="text-xs text-gray-400 shrink-0">›</span>}
            </button>
          ))}
        </div>

        {/* Manual input + select dir */}
        <div className="border-t p-3 space-y-2">
          <div className="flex gap-2">
            <input
              value={manualPath}
              onChange={e => setManualPath(e.target.value)}
              placeholder="手動輸入路徑…"
              className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400 font-mono"
            />
            <button
              onClick={() => manualPath && onSelect(manualPath)}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors"
            >確認</button>
          </div>
          <button
            onClick={() => onSelect(currentPath)}
            className="w-full py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >使用目前目錄：{currentPath}</button>
        </div>
      </div>
    </div>
  )
}

// ── NodeConfigPanel ────────────────────────────────────────────────────────────
interface Props {
  node: PipelineNode
  onUpdate: (data: Partial<StepData>) => void
  onClose: () => void
  onDelete: () => void
  aiExpectText?: string  // 來自 AI 驗證節點的描述（唯讀）
}

export default function NodeConfigPanel({ node, onUpdate, onClose, onDelete, aiExpectText }: Props) {
  const data = node.data
  const color = stepColor(data.index)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [browserTarget, setBrowserTarget] = useState<'batch' | 'output' | null>(null)
  const [venvChecking, setVenvChecking] = useState(false)

  const { prefix: initPrefix, filePath: initPath } = splitBatch(data.batch)
  const [selectedPrefix, setSelectedPrefix] = useState(initPrefix || 'python')

  // Re-sync prefix when node changes
  useEffect(() => {
    const { prefix } = splitBatch(data.batch)
    setSelectedPrefix(prefix || 'python')
  }, [node.id])

  const upd = (patch: Partial<StepData>) => onUpdate(patch)

  const { filePath } = splitBatch(data.batch)
  const isUsingVenv = data.batch.includes('.venv') && data.batch.includes('python')
  const pyPathMatch = data.batch.match(/(?:python\S*|\.venv[/\\]\S*python\S*)\s+(\S+\.py)/)
  const pyPath = pyPathMatch?.[1] ?? null

  const handleVenvToggle = async (checked: boolean) => {
    if (!pyPath) return
    const sep = pyPath.includes('\\') ? '\\' : '/'
    const scriptDir = pyPath.substring(0, pyPath.lastIndexOf(sep))
    if (!checked) {
      // 還原為之前選的前綴，或預設 python3
      const fallback = selectedPrefix.includes('venv') ? 'python' : selectedPrefix || 'python'
      upd({ batch: `${fallback} ${pyPath}` }); setSelectedPrefix(fallback); return
    }
    setVenvChecking(true)
    try {
      const res = await fsCheckVenv(scriptDir)
      if (res.has_venv && res.python_path) {
        upd({ batch: `${res.python_path} ${pyPath}` })
        // 根據回傳路徑自動判斷平台
        const isWin = res.python_path.includes('Scripts')
        setSelectedPrefix(isWin ? '.venv\\Scripts\\python' : '.venv/bin/python')
        toast.success('已切換為虛擬環境 Python')
      } else {
        toast.error(`找不到 .venv，請先在專案目錄建立虛擬環境`, { duration: 8000 })
      }
    } catch { toast.error('檢查虛擬環境失敗') }
    finally { setVenvChecking(false) }
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/20 bg-white font-mono'

  return (
    <>
      {browserTarget && (
        <FileBrowser
          onSelect={path => {
            if (browserTarget === 'batch') {
              let prefix = selectedPrefix
              if (path.endsWith('.sh'))                    { prefix = 'bash';    setSelectedPrefix('bash') }
              else if (path.endsWith('.bat') || path.endsWith('.cmd')) { prefix = 'cmd /c'; setSelectedPrefix('cmd /c') }
              else if (path.endsWith('.ps1'))              { prefix = 'powershell -File'; setSelectedPrefix('powershell -File') }
              else if (path.endsWith('.js') || path.endsWith('.mjs')) { prefix = 'node'; setSelectedPrefix('node') }
              else if (path.endsWith('.py') && !prefix)   { prefix = 'python'; setSelectedPrefix('python') }
              upd({ batch: prefix ? `${prefix} ${path}` : path })
            } else {
              upd({ outputPath: path })
            }
            setBrowserTarget(null)
          }}
          onClose={() => setBrowserTarget(null)}
        />
      )}

      {/* Slide-in panel */}
      <div className="absolute top-0 right-0 h-full w-[380px] bg-white shadow-2xl border-l border-gray-100 flex flex-col z-30 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b" style={{ borderTopColor: color, borderTopWidth: 3 }}>
          <span
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
            style={{ background: color }}
          >
            {data.index + 1}
          </span>
          <span className="font-semibold text-gray-800 text-sm flex-1 truncate">設定步驟</span>
          <button onClick={onDelete} title="刪除步驟" className="text-gray-300 hover:text-red-400 transition-colors p-1">
            🗑
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">步驟名稱</label>
            <input
              value={data.name}
              onChange={e => upd({ name: e.target.value })}
              className={inputCls}
              placeholder="描述這個步驟的功能"
            />
          </div>

          {/* Skill Mode Toggle */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {data.skillMode ? '🔬 Skill 模式' : '執行指令'}
              </label>
              <button
                type="button"
                onClick={() => upd({ skillMode: !data.skillMode })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  data.skillMode ? 'bg-purple-500' : 'bg-gray-300'
                }`}
                title={data.skillMode ? '切換為手動指令' : '切換為 Skill 模式（自然語言）'}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    data.skillMode ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`}
                />
              </button>
            </div>

            {data.skillMode ? (
              /* Skill mode: natural language textarea */
              <>
                <textarea
                  rows={4}
                  value={data.batch}
                  onChange={e => upd({ batch: e.target.value })}
                  placeholder={'用自然語言描述要執行的任務…\n例如：產生一份包含 100 筆隨機用戶資料的 CSV，欄位包含 name、email、age'}
                  className={`${inputCls} resize-none !font-sans leading-relaxed`}
                />
                <div className="mt-1.5 p-2 rounded-lg bg-purple-50 border border-purple-200">
                  <p className="text-xs text-purple-700">
                    <span className="font-semibold">Skill 模式：</span>AI 會自主撰寫並執行程式碼來完成任務
                  </p>
                  <p className="text-xs text-purple-500 mt-0.5">可用工具：run_python · run_shell · read_file</p>
                </div>
              </>
            ) : (
              /* Normal mode: prefix + file path */
              <>
                <div className="flex gap-1.5 mb-1.5">
                  <select
                    value={selectedPrefix}
                    onChange={e => {
                      const p = e.target.value
                      setSelectedPrefix(p)
                      if (filePath) upd({ batch: p ? `${p} ${filePath}` : filePath })
                    }}
                    className="shrink-0 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white text-gray-700 outline-none focus:border-indigo-400 cursor-pointer"
                  >
                    <optgroup label="跨平台">
                      {EXEC_PREFIXES.filter(p => p.platform === 'cross').map((p, i) => (
                        <option key={`c-${i}`} value={p.value}>{p.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="macOS / Linux">
                      {EXEC_PREFIXES.filter(p => p.platform === 'unix').map((p, i) => (
                        <option key={`u-${i}`} value={p.value}>{p.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Windows">
                      {EXEC_PREFIXES.filter(p => p.platform === 'win').map((p, i) => (
                        <option key={`w-${i}`} value={p.value}>{p.label}</option>
                      ))}
                    </optgroup>
                  </select>
                  <span className="text-gray-300 text-sm self-center">+</span>
                  <input
                    value={splitBatch(data.batch).filePath}
                    onChange={e => {
                      const fp = e.target.value
                      upd({ batch: selectedPrefix ? `${selectedPrefix} ${fp}` : fp })
                    }}
                    placeholder="選擇或輸入檔案路徑"
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    onClick={() => setBrowserTarget('batch')}
                    className="shrink-0 w-8 h-8 flex items-center justify-center border border-gray-200 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors"
                  ><FolderOpen className="w-3.5 h-3.5" /></button>
                </div>
                {data.batch && (
                  <div className="text-xs text-gray-400 font-mono bg-gray-50 rounded-lg px-2.5 py-1.5 truncate">
                    ▶ {data.batch}
                  </div>
                )}
                {/* Venv toggle */}
                {pyPath && (
                  <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isUsingVenv}
                      onChange={e => handleVenvToggle(e.target.checked)}
                      disabled={venvChecking}
                      className="w-3.5 h-3.5 rounded accent-indigo-500"
                    />
                    <span className="text-xs text-gray-500">
                      {venvChecking ? '偵測中…' : '使用 .venv 虛擬環境'}
                    </span>
                  </label>
                )}
              </>
            )}
          </div>

          {/* Output path */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">輸出路徑</label>
            <div className="flex gap-1.5">
              <input
                value={data.outputPath}
                onChange={e => upd({ outputPath: e.target.value })}
                placeholder="~/ai_output/..."
                className={`${inputCls} flex-1`}
              />
              <button
                onClick={() => setBrowserTarget('output')}
                className="shrink-0 w-8 h-8 flex items-center justify-center border border-gray-200 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors"
              ><FolderOpen className="w-3.5 h-3.5" /></button>
            </div>
            <p className="text-xs text-gray-400 mt-1">Pipeline 用此路徑確認步驟是否成功執行</p>
          </div>

          {/* Advanced */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-indigo-600 transition-colors"
            >
              {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              進階設定
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 pl-4 border-l-2 border-gray-100">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 block mb-1">逾時（秒）</label>
                    <input
                      type="number" min={10} max={3600}
                      value={data.timeout}
                      onChange={e => upd({ timeout: parseInt(e.target.value) || 300 })}
                      className={inputCls}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 block mb-1">自動重試次數</label>
                    <input
                      type="number" min={0} max={5}
                      value={data.retry}
                      onChange={e => upd({ retry: parseInt(e.target.value) || 0 })}
                      className={inputCls}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">期望輸出描述（AI 驗證用）</label>
                  {aiExpectText ? (
                    <div className="w-full border border-purple-200 bg-purple-50 rounded-lg px-2.5 py-1.5 text-xs font-mono text-purple-700 leading-relaxed">
                      <span className="text-purple-400 mr-1">✦</span>{aiExpectText}
                    </div>
                  ) : (
                    <textarea
                      rows={2}
                      value={data.expect}
                      onChange={e => upd({ expect: e.target.value })}
                      placeholder="描述輸出應包含什麼內容…"
                      className={`${inputCls} resize-none`}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>步驟 {data.index + 1}</span>
            <span className={`px-2 py-0.5 rounded-full font-medium ${
              data.status === 'success' ? 'bg-green-100 text-green-700' :
              data.status === 'failed'  ? 'bg-red-100 text-red-700' :
              data.status === 'running' ? 'bg-blue-100 text-blue-700' :
              'bg-gray-100 text-gray-500'
            }`}>
              {data.status === 'idle' ? '等待中' : data.status === 'running' ? '執行中' : data.status === 'success' ? '成功' : '失敗'}
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
