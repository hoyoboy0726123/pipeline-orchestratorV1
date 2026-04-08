import type { Node, Edge } from '@xyflow/react'

// ── 資料型別 ─────────────────────────────────────────────────────────────────

/** 腳本節點：執行用戶寫好的腳本或指令 */
export interface StepData extends Record<string, unknown> {
  name: string
  batch: string
  workingDir: string
  outputPath: string
  expect: string
  skillMode?: boolean   // optional — 僅在 YAML 序列化時使用，節點類型由 node.type 決定
  timeout: number
  retry: number
  index: number
  status: 'idle' | 'running' | 'success' | 'failed'
  errorMsg: string
}

/** 技能節點：LLM 自動撰寫並執行程式碼 */
export interface SkillData extends Record<string, unknown> {
  name: string
  taskDescription: string
  workingDir: string
  outputPath: string
  expectedOutput: string
  timeout: number
  retry: number
  index: number
  status: 'idle' | 'running' | 'success' | 'failed'
  errorMsg: string
}

/** AI 驗證節點：輕量 LLM 快速驗證前一步輸出 */
export interface AiValidationData extends Record<string, unknown> {
  expectText: string
  targetPath: string
  skillMode: boolean   // 保留：控制驗證時是否可執行程式碼
  index: number
}

export type ScriptNode = Node<StepData>
export type SkillNode = Node<SkillData>
export type AiValidationNode = Node<AiValidationData>
export type AppNode = Node<StepData | AiValidationData | SkillData>

export function newAiValidationData(index = 0): AiValidationData {
  return { expectText: '', targetPath: '', skillMode: false, index }
}

let _counter = 0
export function newStepData(index = 0): StepData {
  _counter++
  return {
    name: `Python腳本 ${_counter}`,
    batch: '',
    workingDir: '',
    outputPath: '',
    expect: '',
    timeout: 300,
    retry: 0,
    index,
    status: 'idle',
    errorMsg: '',
  }
}

let _skillCounter = 0
export function newSkillData(index = 0): SkillData {
  _skillCounter++
  return {
    name: `AI技能 ${_skillCounter}`,
    taskDescription: '',
    workingDir: '',
    outputPath: '',
    expectedOutput: '',
    timeout: 300,
    retry: 0,
    index,
    status: 'idle',
    errorMsg: '',
  }
}

// ── 節點顏色（依 index 循環）──────────────────────────────────────────────────
const COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ec4899','#8b5cf6','#14b8a6','#f97316']
export const stepColor = (index: number) => COLORS[index % COLORS.length]

// ── Steps → ReactFlow nodes + edges ──────────────────────────────────────────
export function stepsToFlow(steps: StepData[]): { nodes: AppNode[]; edges: Edge[] } {
  const nodes: AppNode[] = steps.map((s, i) => {
    if (s.skillMode) {
      // 向後相容：舊格式 skillMode=true → skillStep 節點
      return {
        id: `step-${i}`,
        type: 'skillStep' as const,
        position: { x: i * 320, y: 160 },
        data: {
          name: s.name,
          taskDescription: s.batch,
          workingDir: s.workingDir,
          outputPath: s.outputPath,
          expectedOutput: s.expect,
          timeout: s.timeout,
          retry: s.retry,
          index: i,
          status: 'idle' as const,
          errorMsg: '',
        } as SkillData,
      }
    }
    return {
      id: `step-${i}`,
      type: 'scriptStep' as const,
      position: { x: i * 320, y: 160 },
      data: { ...s, index: i, skillMode: undefined },
    }
  })

  const edges: Edge[] = steps.slice(0, -1).map((_, i) => ({
    id: `e-${i}`,
    source: `step-${i}`,
    target: `step-${i + 1}`,
    type: 'smoothstep',
    animated: steps[i].status === 'running',
    style: { stroke: stepColor(i), strokeWidth: 2 },
  }))

  return { nodes, edges }
}

// ── ReactFlow nodes → ordered steps（只包含有邊連接的節點）──────────────────────
export function flowToSteps(nodes: AppNode[], edges: Edge[]): StepData[] {
  // 收集 AI 驗證節點，建立 predecessor → aiData 映射
  const aiNodeIds = new Set<string>()
  const aiDataByPredecessor = new Map<string, AiValidationData>()

  for (const n of nodes) {
    if (n.type === 'aiValidation') {
      aiNodeIds.add(n.id)
      const inEdge = edges.find(e => e.target === n.id)
      if (inEdge) aiDataByPredecessor.set(inEdge.source, n.data as AiValidationData)
    }
  }

  // 過濾出步驟節點（scriptStep + skillStep）
  const stepNodes = nodes.filter(n => n.type === 'scriptStep' || n.type === 'skillStep')
  if (stepNodes.length === 0) return []

  // 建立虛擬邊（跳過 AI 驗證節點）
  const stepIds = new Set(stepNodes.map(n => n.id))
  const virtualEdges: Edge[] = []
  for (const e of edges) {
    if (aiNodeIds.has(e.source)) continue
    if (aiNodeIds.has(e.target)) {
      const aiOutEdge = edges.find(e2 => e2.source === e.target)
      if (aiOutEdge && stepIds.has(aiOutEdge.target)) {
        virtualEdges.push({ ...e, target: aiOutEdge.target, id: `v-${e.id}` })
      }
      continue
    }
    if (stepIds.has(e.source) && stepIds.has(e.target)) {
      virtualEdges.push(e)
    }
  }

  // 找起點（無入邊的步驟節點）
  const hasIncoming = new Set(virtualEdges.map(e => e.target))
  const starts = stepNodes.filter(n => !hasIncoming.has(n.id))
  if (!starts.length) return []

  // 沿邊走，只收集有連接的節點
  const adj = new Map<string, string>()
  virtualEdges.forEach(e => adj.set(e.source, e.target))

  const ordered: AppNode[] = []
  const visited = new Set<string>()
  let cur: string | undefined = starts[0].id
  while (cur && !visited.has(cur)) {
    visited.add(cur)
    const node = stepNodes.find(n => n.id === cur)
    if (node) ordered.push(node)
    cur = adj.get(cur)
  }

  // 孤立節點不加入（邊驅動執行）

  return ordered.map((n, i) => {
    const aiData = aiDataByPredecessor.get(n.id)

    if (n.type === 'skillStep') {
      const d = n.data as SkillData
      return {
        name: d.name,
        batch: d.taskDescription,
        workingDir: d.workingDir || '',
        outputPath: d.outputPath,
        expect: aiData?.expectText || d.expectedOutput,
        skillMode: true,
        timeout: d.timeout,
        retry: d.retry,
        index: i,
        status: d.status,
        errorMsg: d.errorMsg,
      } as StepData
    }

    const d = n.data as StepData
    return {
      name: d.name,
      batch: d.batch,
      workingDir: d.workingDir || '',
      outputPath: (aiData?.targetPath && !d.outputPath) ? aiData.targetPath : d.outputPath,
      expect: aiData?.expectText || d.expect,
      skillMode: aiData?.skillMode || false,
      timeout: d.timeout,
      retry: d.retry,
      index: i,
      status: d.status,
      errorMsg: d.errorMsg,
    } as StepData
  })
}

// ── Steps → YAML string ───────────────────────────────────────────────────────
export function stepsToYaml(name: string, steps: StepData[]): string {
  // 自動判斷 validate：有 skill 步驟或任何步驟有 expect → 啟用
  const needsValidate = steps.some(s => s.skillMode || !!s.expect)
  const lines: string[] = [
    `name: ${name || 'my-pipeline'}`,
    `validate: ${needsValidate}`,
    ``,
    `steps:`,
  ]
  for (const s of steps) {
    lines.push(`  - name: ${s.name}`)
    if (s.workingDir) lines.push(`    working_dir: ${s.workingDir}`)
    if (s.batch) {
      if (s.batch.includes('\n')) {
        lines.push(`    batch: |`)
        for (const bl of s.batch.split('\n')) {
          lines.push(`      ${bl}`)
        }
      } else {
        lines.push(`    batch: ${s.batch}`)
      }
    }
    if (s.skillMode) lines.push(`    skill_mode: true`)
    if (s.outputPath || s.expect) {
      lines.push(`    output:`)
      if (s.outputPath) lines.push(`      path: ${s.outputPath}`)
      if (s.expect) {
        lines.push(`      ai_validation: true`)
        if (s.expect.includes('\n')) {
          lines.push(`      description: |`)
          for (const dl of s.expect.split('\n')) {
            lines.push(`        ${dl}`)
          }
        } else {
          lines.push(`      description: "${s.expect.replace(/"/g, '\\"')}"`)
        }
      }
      if (s.skillMode) lines.push(`      skill_mode: true`)
    }
    if (s.timeout !== 300) lines.push(`    timeout: ${s.timeout}`)
    if (s.retry > 0)       lines.push(`    retry: ${s.retry}`)
  }
  return lines.join('\n')
}

// ── YAML string → steps ───────────────────────────────────────────────────────
export function parseYaml(raw: string): { name: string; validate: boolean; steps: StepData[] } | null {
  try {
    const lines = raw.split('\n')
    let stepIndent = 2
    for (const line of lines) {
      const m = line.match(/^(\s*)- name:/)
      if (m) { stepIndent = m[1].length; break }
    }

    let name = 'my-pipeline'
    let validate = false
    const steps: StepData[] = []
    let cur: Partial<StepData> | null = null
    let inOutput = false
    let multilineTarget: 'batch' | 'expect' | null = null
    let multilineIndent = 0
    let multilineLines: string[] = []

    const flushMultiline = () => {
      if (multilineTarget && cur && multilineLines.length > 0) {
        const text = multilineLines.join('\n').replace(/\n+$/, '')
        if (multilineTarget === 'batch') cur.batch = text
        else cur.expect = text
      }
      multilineTarget = null
      multilineLines = []
      multilineIndent = 0
    }

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]
      const t = line.trim()

      if (multilineTarget) {
        if (t === '') { multilineLines.push(''); continue }
        const leadingSpaces = line.match(/^(\s*)/)?.[1].length ?? 0
        if (leadingSpaces >= multilineIndent) {
          multilineLines.push(line.slice(multilineIndent))
          continue
        }
        flushMultiline()
      }

      if (!t || t.startsWith('#') || t === 'pipeline:' || t === 'steps:') continue

      if (/^name:/.test(t) && !cur) {
        name = t.replace(/^name:\s*/, '')
      } else if (/^validate:/.test(t) && !cur) {
        validate = /true/.test(t)
      } else if (/^- name:/.test(t)) {
        flushMultiline()
        if (cur) steps.push(buildStep(cur, steps.length))
        cur = { name: t.replace(/^-\s*name:\s*/, '') }
        inOutput = false
      } else if (/^working_dir:/.test(t) && cur) {
        cur.workingDir = t.replace(/^working_dir:\s*/, '')
        inOutput = false
      } else if (/^batch:/.test(t) && cur) {
        const val = t.replace(/^batch:\s*/, '')
        if (val === '|' || val === '>') {
          multilineTarget = 'batch'
          const nextLine = lines[li + 1]
          multilineIndent = nextLine ? (nextLine.match(/^(\s*)/)?.[1].length ?? 0) : 0
        } else {
          cur.batch = val
        }
        inOutput = false
      } else if (/^output:/.test(t) && cur) {
        inOutput = true
      } else if (/^path:/.test(t) && cur && inOutput) {
        cur.outputPath = t.replace(/^path:\s*/, '')
      } else if (/^(expect|description):/.test(t) && cur && inOutput) {
        const val = t.replace(/^(expect|description):\s*/, '').replace(/^"|"$/g, '')
        if (val === '|' || val === '>') {
          multilineTarget = 'expect'
          const nextLine = lines[li + 1]
          multilineIndent = nextLine ? (nextLine.match(/^(\s*)/)?.[1].length ?? 0) : 0
        } else {
          cur.expect = val
        }
      } else if (/^ai_validation:/.test(t) && cur && inOutput) {
        if (/true/.test(t)) validate = true
      } else if (/^skill_mode:/.test(t) && cur) {
        cur.skillMode = /true/.test(t)
      } else if (/^timeout:/.test(t) && cur) {
        cur.timeout = parseInt(t.replace(/^timeout:\s*/, '')) || 300
        inOutput = false
      } else if (/^retry:/.test(t) && cur) {
        cur.retry = parseInt(t.replace(/^retry:\s*/, '')) || 0
        inOutput = false
      }
    }
    flushMultiline()
    if (cur) steps.push(buildStep(cur, steps.length))
    return { name, validate, steps }
  } catch { return null }
}

function buildStep(partial: Partial<StepData>, index: number): StepData {
  return {
    name: partial.name ?? `步驟 ${index + 1}`,
    batch: partial.batch ?? '',
    workingDir: partial.workingDir ?? '',
    outputPath: partial.outputPath ?? '',
    expect: partial.expect ?? '',
    skillMode: partial.skillMode ?? false,
    timeout: partial.timeout ?? 300,
    retry: partial.retry ?? 0,
    index,
    status: 'idle',
    errorMsg: '',
  }
}
