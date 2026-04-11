'use client'

import { useEffect, useState } from 'react'
import { Settings as SettingsIcon, Save, RefreshCw, AlertCircle, CheckCircle2, Cloud, HardDrive, ArrowLeft, Brain, Package, Plus, Trash2, Loader2, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { toast, Toaster } from 'sonner'
import {
  getModelSettings, saveModelSettings, getAvailableModels,
  getSkillPackages, addSkillPackage, removeSkillPackage,
  type ModelSettings, type AvailableModels, type SkillPackage,
} from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Skill Packages Section ────────────────────────────────────────────────────
function SkillPackagesSection() {
  const [packages, setPackages] = useState<SkillPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [newPkg, setNewPkg] = useState('')
  const [installing, setInstalling] = useState(false)
  const [removingPkg, setRemovingPkg] = useState<string | null>(null)

  const loadPkgs = async () => {
    setLoading(true)
    try {
      const pkgs = await getSkillPackages()
      setPackages(pkgs)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPkgs() }, [])

  const handleAdd = async () => {
    const name = newPkg.trim()
    if (!name) return
    setInstalling(true)
    try {
      const msg = await addSkillPackage(name)
      toast.success(msg)
      setNewPkg('')
      await loadPkgs()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setInstalling(false)
    }
  }

  const handleRemove = async (name: string) => {
    setRemovingPkg(name)
    try {
      const msg = await removeSkillPackage(name)
      toast.success(msg)
      await loadPkgs()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRemovingPkg(null)
    }
  }

  return (
    <div className="mt-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
          <Package className="w-5 h-5 text-purple-700" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">AI技能套件</h2>
          <p className="text-sm text-gray-500">管理 AI技能節點可使用的 Python 第三方套件</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* 新增套件 */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex gap-2">
            <input
              value={newPkg}
              onChange={e => setNewPkg(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="輸入套件名稱（如 selenium、numpy）"
              disabled={installing}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            <button
              onClick={handleAdd}
              disabled={installing || !newPkg.trim()}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-all',
                installing || !newPkg.trim()
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-purple-600 text-white hover:bg-purple-700'
              )}
            >
              {installing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              安裝
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">套件會安裝到後端的 Python 環境中，AI技能節點執行時可直接 import 使用</p>
        </div>

        {/* 套件清單 */}
        <div className="divide-y divide-gray-100">
          {loading ? (
            <div className="p-6 text-center text-gray-400 text-sm">
              <RefreshCw className="w-4 h-4 animate-spin inline-block mr-2" />
              載入中...
            </div>
          ) : packages.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">尚無套件</div>
          ) : (
            packages.map(pkg => (
              <div key={pkg.name} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-medium text-gray-900">{pkg.name}</span>
                    {pkg.installed ? (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                        {pkg.version || '已安裝'}
                      </span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">
                        未安裝
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(pkg.name)}
                  disabled={removingPkg === pkg.name}
                  className="p-1.5 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50"
                  title="移除套件"
                >
                  {removingPkg === pkg.name
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            ))
          )}
        </div>

        {/* 底部說明 */}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            套件清單儲存在 <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">backend/skill_packages.txt</code>，後端啟動時自動安裝缺少的套件
          </p>
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [current, setCurrent] = useState<ModelSettings | null>(null)
  const [available, setAvailable] = useState<AvailableModels | null>(null)
  const [provider, setProvider] = useState<'groq' | 'ollama' | 'gemini'>('groq')
  const [model, setModel] = useState('')
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')
  const [thinking, setThinking] = useState<'auto' | 'on' | 'off'>('off')
  const [numCtx, setNumCtx] = useState<number>(16384)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [cur, avail] = await Promise.all([getModelSettings(), getAvailableModels()])
      setCurrent(cur)
      setAvailable(avail)
      setProvider(cur.provider)
      setModel(cur.model)
      setOllamaUrl(cur.ollama_base_url || 'http://localhost:11434')
      setThinking(cur.ollama_thinking || 'off')
      setNumCtx(cur.ollama_num_ctx || 16384)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSave = async () => {
    if (!model) {
      toast.error('請選擇模型')
      return
    }
    setSaving(true)
    try {
      const saved = await saveModelSettings({ provider, model, ollama_base_url: ollamaUrl, ollama_thinking: thinking, ollama_num_ctx: numCtx })
      setCurrent(saved)
      toast.success(`已儲存：${saved.provider} / ${saved.model}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const options = provider === 'groq'
    ? (available?.groq ?? [])
    : provider === 'gemini'
    ? (available?.gemini ?? [])
    : (available?.ollama ?? [])
  const dirty = current && (
    provider !== current.provider ||
    model !== current.model ||
    ollamaUrl !== current.ollama_base_url ||
    thinking !== current.ollama_thinking ||
    numCtx !== current.ollama_num_ctx
  )

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      <Toaster position="top-right" richColors />
      <div className="max-w-3xl mx-auto p-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/pipeline"
            className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-white transition-colors"
            title="回到 Pipeline"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
            <SettingsIcon className="w-5 h-5 text-brand-700" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">設定</h1>
            <p className="text-sm text-gray-500">調整 Pipeline 執行與驗證時使用的 LLM 模型</p>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin inline-block mr-2" />
            載入中...
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Current */}
            <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-brand-50 to-purple-50">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">目前使用的模型</div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-xs font-semibold uppercase bg-white border border-gray-200 text-gray-700">
                  {current?.provider}
                </span>
                <span className="font-mono text-sm font-medium text-gray-900">
                  {current?.model}
                </span>
              </div>
            </div>

            {/* Provider 選擇 */}
            <div className="p-6 border-b border-gray-100">
              <label className="block text-sm font-medium text-gray-700 mb-3">提供者</label>
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => { setProvider('groq'); setModel(available?.groq?.[0]?.id ?? '') }}
                  className={cn(
                    'flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left',
                    provider === 'groq'
                      ? 'border-brand-600 bg-brand-50'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                >
                  <Cloud className={cn('w-5 h-5 shrink-0', provider === 'groq' ? 'text-brand-700' : 'text-gray-400')} />
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-gray-900">Groq Cloud</div>
                    <div className="text-xs text-gray-500">雲端 API，速度快</div>
                  </div>
                </button>
                <button
                  onClick={() => { setProvider('gemini'); setModel(available?.gemini?.[0]?.id ?? 'gemma-4-31b-it') }}
                  className={cn(
                    'flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left',
                    provider === 'gemini'
                      ? 'border-brand-600 bg-brand-50'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                >
                  <Sparkles className={cn('w-5 h-5 shrink-0', provider === 'gemini' ? 'text-brand-700' : 'text-gray-400')} />
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-gray-900">Google Gemini</div>
                    <div className="text-xs text-gray-500">固定 gemma-4-31b-it</div>
                  </div>
                </button>
                <button
                  onClick={() => { setProvider('ollama'); setModel(available?.ollama?.[0]?.id ?? '') }}
                  className={cn(
                    'flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left',
                    provider === 'ollama'
                      ? 'border-brand-600 bg-brand-50'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                >
                  <HardDrive className={cn('w-5 h-5 shrink-0', provider === 'ollama' ? 'text-brand-700' : 'text-gray-400')} />
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-gray-900">Ollama 本地</div>
                    <div className="text-xs text-gray-500">離線運行，無配額</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Ollama URL */}
            {provider === 'ollama' && (
              <div className="p-6 border-b border-gray-100">
                <label className="block text-sm font-medium text-gray-700 mb-2">Ollama Base URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    placeholder="http://localhost:11434"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  />
                  <button
                    onClick={load}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-4 h-4" />
                    重新讀取
                  </button>
                </div>
                {available?.ollama_error && (
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{available.ollama_error}</span>
                  </div>
                )}
              </div>
            )}

            {/* 思考模式（僅 Ollama）*/}
            {provider === 'ollama' && (
              <div className="p-6 border-b border-gray-100">
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                  <Brain className="w-4 h-4" />
                  思考模式
                </label>
                <p className="text-xs text-gray-500 mb-3">控制 qwen3 等支援思考的模型是否輸出推理過程（關閉可大幅加快速度）</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { v: 'auto', label: '預設', desc: '依模型設定' },
                    { v: 'off',  label: '關閉思考', desc: '最快，省時間' },
                    { v: 'on',   label: '開啟思考', desc: '更準確，較慢' },
                  ] as const).map(opt => (
                    <button
                      key={opt.v}
                      onClick={() => setThinking(opt.v)}
                      className={cn(
                        'p-3 rounded-lg border-2 transition-all text-left',
                        thinking === opt.v
                          ? 'border-brand-600 bg-brand-50'
                          : 'border-gray-200 hover:border-gray-300'
                      )}
                    >
                      <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Context window（僅 Ollama）*/}
            {provider === 'ollama' && (
              <div className="p-6 border-b border-gray-100">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Context 長度 (num_ctx)
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  模型一次能處理的 token 數。越大越不容易截斷，但吃更多 VRAM 且變慢。預設 16384 通常足夠。
                </p>
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {[8192, 16384, 32768, 65536].map((v) => (
                    <button
                      key={v}
                      onClick={() => setNumCtx(v)}
                      className={cn(
                        'p-2 rounded-lg border-2 transition-all text-sm',
                        numCtx === v
                          ? 'border-brand-600 bg-brand-50 text-brand-700 font-medium'
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      )}
                    >
                      {v >= 1024 ? `${v / 1024}K` : v}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  value={numCtx}
                  onChange={(e) => setNumCtx(Math.max(2048, Math.min(262144, parseInt(e.target.value) || 16384)))}
                  min={2048}
                  max={262144}
                  step={2048}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
            )}

            {/* 模型選擇 */}
            <div className="p-6 border-b border-gray-100">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                模型
                {provider === 'ollama' && <span className="text-xs text-gray-400 ml-2">（讀取自 ollama list）</span>}
              </label>
              {options.length === 0 ? (
                <div className="p-4 bg-gray-50 rounded-lg text-sm text-gray-500 text-center">
                  {provider === 'ollama' ? '尚未發現任何 Ollama 本地模型' : '無可用模型'}
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {options.map((opt) => (
                    <label
                      key={opt.id}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all',
                        model === opt.id
                          ? 'border-brand-600 bg-brand-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      )}
                    >
                      <input
                        type="radio"
                        name="model"
                        value={opt.id}
                        checked={model === opt.id}
                        onChange={() => setModel(opt.id)}
                        className="accent-brand-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{opt.label}</div>
                        <div className="text-xs text-gray-500 font-mono truncate">{opt.id}</div>
                      </div>
                      {model === opt.id && current?.model === opt.id && current?.provider === provider && (
                        <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0" />
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* 儲存 */}
            <div className="px-6 py-4 bg-gray-50/50 flex items-center justify-between">
              <div className="text-xs text-gray-500">
                {dirty ? '有未儲存的變更' : '尚無變更'}
              </div>
              <button
                onClick={handleSave}
                disabled={saving || !dirty || !model}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all',
                  dirty && model && !saving
                    ? 'bg-brand-600 text-white hover:bg-brand-700'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                )}
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                儲存設定
              </button>
            </div>
          </div>
        )}

        {/* Skill Packages */}
        <SkillPackagesSection />

        {/* 提示 */}
        <div className="mt-4 text-xs text-gray-500 space-y-1">
          <p>• 設定會立即生效（新 pipeline 執行會使用新模型）</p>
          <p>• 設定儲存在 <code className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">~/ai_output/pipeline_settings.json</code></p>
          <p>• Ollama 模型列表從本機 <code className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">ollama list</code> 動態讀取</p>
        </div>
      </div>
    </div>
  )
}
