import type { OutputFormat, StepEvent, ScheduledTask, FileItem, OpenCLICategory, OpenCLIStatus, AgentMode, PipelineRun } from './types'

const BASE = '/api/backend'

// ── Chat / Run ──────────────────────────────────────────────
export async function* streamTask(
  task: string,
  format: OutputFormat = 'md',
  savePath?: string,
  mode: AgentMode = 'auto'
): AsyncGenerator<StepEvent> {
  const res = await fetch(`${BASE}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, output_format: format, save_path: savePath ?? null, stream: true, mode }),
  })

  if (!res.ok) {
    throw new Error(`API 錯誤：${res.status}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('無法讀取串流')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    let event = ''
    let data = ''

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        event = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        data = line.slice(6).trim()
      } else if (line === '' && event && data) {
        try {
          const parsed = JSON.parse(data)
          yield { type: event as StepEvent['type'], ...parsed }
        } catch { /* ignore malformed */ }
        event = ''
        data = ''
      }
    }
  }
}

// ── Tasks ───────────────────────────────────────────────────
export async function getTasks(): Promise<ScheduledTask[]> {
  const res = await fetch(`${BASE}/tasks`)
  const data = await res.json()
  return data.tasks ?? []
}

export async function createTask(task: {
  name: string
  task_prompt: string
  output_format: OutputFormat
  save_path?: string
  schedule_type: string
  schedule_expr: string
}): Promise<ScheduledTask> {
  const res = await fetch(`${BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail ?? 'Create task failed')
  }
  const data = await res.json()
  return data.task
}

export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`${BASE}/tasks/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Delete task failed')
}

// ── FS Browser ──────────────────────────────────────────────
export async function fsBrowse(path = ''): Promise<{
  path: string
  parent: string | null
  items: { name: string; path: string; is_dir: boolean; ext: string }[]
}> {
  const res = await fetch(`${BASE}/fs/browse?path=${encodeURIComponent(path)}`)
  return res.json()
}

export async function fsCheckVenv(dir: string): Promise<{ has_venv: boolean; python_path: string | null }> {
  const res = await fetch(`${BASE}/fs/check-venv?dir=${encodeURIComponent(dir)}`)
  if (!res.ok) throw new Error('檢查失敗')
  return res.json()
}

// ── Files ───────────────────────────────────────────────────
export async function listFiles(path = ''): Promise<FileItem[]> {
  const res = await fetch(`${BASE}/files?path=${encodeURIComponent(path)}`)
  const data = await res.json()
  return data.files ?? []
}

export async function readFile(path: string): Promise<{ content: string; name: string }> {
  const res = await fetch(`${BASE}/files/content?path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error('Read file failed')
  return res.json()
}

// ── Health ──────────────────────────────────────────────────
export async function getHealth(): Promise<{ status: string; warnings: string[] }> {
  const res = await fetch(`${BASE}/health`)
  return res.json()
}

// ── OpenCLI ─────────────────────────────────────────────────
export async function getOpenCLISites(): Promise<OpenCLICategory[]> {
  const res = await fetch(`${BASE}/opencli/sites`)
  const data = await res.json()
  return data.sites ?? []
}

export async function getOpenCLIStatus(): Promise<OpenCLIStatus> {
  const res = await fetch(`${BASE}/opencli/status`)
  return res.json()
}

// ── Pipeline ─────────────────────────────────────────────────
export async function getPipelineRuns(): Promise<PipelineRun[]> {
  const res = await fetch(`${BASE}/pipeline/runs`)
  const data = await res.json()
  return data.runs ?? []
}

export async function getPipelineRun(runId: string): Promise<PipelineRun> {
  const res = await fetch(`${BASE}/pipeline/runs/${runId}`)
  if (!res.ok) throw new Error('找不到 pipeline run')
  return res.json()
}

export async function startPipeline(yamlContent: string, validate = true): Promise<{ run_id: string }> {
  const res = await fetch(`${BASE}/pipeline/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ yaml_content: yamlContent, validate }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail ?? 'Pipeline 啟動失敗')
  }
  return res.json()
}

export async function deletePipelineRun(runId: string): Promise<void> {
  const res = await fetch(`${BASE}/pipeline/runs/${runId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('刪除失敗')
}

export async function resumePipeline(runId: string, decision: 'retry' | 'skip' | 'abort'): Promise<{ message: string }> {
  const res = await fetch(`${BASE}/pipeline/runs/${runId}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  })
  if (!res.ok) throw new Error('Resume 失敗')
  return res.json()
}

export async function getPipelineLog(runId: string): Promise<{ log: string }> {
  const res = await fetch(`${BASE}/pipeline/runs/${runId}/log`)
  if (!res.ok) throw new Error('取得 log 失敗')
  return res.json()
}

export async function getPipelineScheduled(): Promise<ScheduledTask[]> {
  const res = await fetch(`${BASE}/pipeline/scheduled`)
  const data = await res.json()
  return data.tasks ?? []
}

export async function createPipelineSchedule(req: {
  name: string
  yaml_content: string
  schedule_type: string
  schedule_expr: string
  validate?: boolean
}): Promise<ScheduledTask> {
  const res = await fetch(`${BASE}/pipeline/scheduled`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail ?? '建立排程失敗')
  }
  const data = await res.json()
  return data.task
}

export async function deletePipelineSchedule(taskId: string): Promise<void> {
  const res = await fetch(`${BASE}/pipeline/scheduled/${taskId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('刪除排程失敗')
}

// ── Settings ─────────────────────────────────────────────────
export interface ModelSettings {
  provider: 'groq' | 'ollama'
  model: string
  ollama_base_url: string
  ollama_thinking: 'auto' | 'on' | 'off'
  ollama_num_ctx: number
}

export interface ModelOption {
  id: string
  label: string
}

export interface AvailableModels {
  groq: ModelOption[]
  ollama: ModelOption[]
  ollama_base_url: string
  ollama_error: string | null
}

export async function getModelSettings(): Promise<ModelSettings> {
  const res = await fetch(`${BASE}/settings/model`)
  if (!res.ok) throw new Error('讀取設定失敗')
  return res.json()
}

export async function saveModelSettings(s: ModelSettings): Promise<ModelSettings> {
  const res = await fetch(`${BASE}/settings/model`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? '儲存失敗')
  }
  return res.json()
}

export async function getAvailableModels(): Promise<AvailableModels> {
  const res = await fetch(`${BASE}/settings/models/available`)
  if (!res.ok) throw new Error('讀取模型清單失敗')
  return res.json()
}

// ── Recipe Book ─────────────────────────────────────────────
export interface Recipe {
  recipe_id: string
  pipeline_id: string
  step_name: string
  task_hash: string
  input_fingerprints: Record<string, string>
  output_path: string | null
  code: string
  python_version: string
  success_count: number
  fail_count: number
  created_at: number
  last_success_at: number
  last_fail_at: number
  avg_runtime_sec: number
  disabled: boolean
}

export async function listRecipes(): Promise<Recipe[]> {
  const res = await fetch(`${BASE}/recipes`)
  if (!res.ok) throw new Error('讀取 recipes 失敗')
  return res.json()
}

export async function deleteRecipe(pipelineName: string, stepName: string): Promise<void> {
  const res = await fetch(`${BASE}/recipes/${encodeURIComponent(pipelineName)}/${encodeURIComponent(stepName)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('刪除 recipe 失敗')
}

export async function deletePipelineRecipes(pipelineName: string): Promise<number> {
  const res = await fetch(`${BASE}/recipes/${encodeURIComponent(pipelineName)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('刪除 pipeline recipes 失敗')
  const data = await res.json()
  return data.deleted_count ?? 0
}

export async function pipelineChat(messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<{
  reply: string
  has_yaml: boolean
  yaml_content: string | null
}> {
  const res = await fetch(`${BASE}/pipeline/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  if (!res.ok) throw new Error('AI 回應失敗')
  return res.json()
}
