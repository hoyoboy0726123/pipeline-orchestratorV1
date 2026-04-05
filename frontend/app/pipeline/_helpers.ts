import type { Node, Edge } from '@xyflow/react'

// ── 資料型別 ─────────────────────────────────────────────────────────────────
export interface StepData extends Record<string, unknown> {
  name: string
  batch: string
  workingDir: string
  outputPath: string
  expect: string
  skillMode: boolean
  timeout: number
  retry: number
  index: number
  status: 'idle' | 'running' | 'success' | 'failed'
  errorMsg: string
}

export interface AiValidationData extends Record<string, unknown> {
  expectText: string
  targetPath: string
  skillMode: boolean
  index: number
}

export type PipelineNode = Node<StepData>
export type AiValidationNode = Node<AiValidationData>
export type AppNode = Node<StepData | AiValidationData>

export function newAiValidationData(index = 0): AiValidationData {
  return { expectText: '', targetPath: '', skillMode: false, index }
}

let _counter = 0
export function newStepData(index = 0): StepData {
  _counter++
  return {
    name: `步驟 ${_counter}`,
    batch: '',
    workingDir: '',
    outputPath: '',
    expect: '',
    skillMode: false,
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
export function stepsToFlow(steps: StepData[]): { nodes: PipelineNode[]; edges: Edge[] } {
  const nodes: PipelineNode[] = steps.map((s, i) => ({
    id: `step-${i}`,
    type: 'pipelineStep',
    position: { x: i * 320, y: 160 },
    data: { ...s, index: i },
  }))

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

// ── ReactFlow nodes → ordered steps ──────────────────────────────────────────
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

  // 過濾出步驟節點，並建立虛擬邊（跳過 AI 驗證節點）
  const stepNodes = nodes.filter(n => n.type !== 'aiValidation') as PipelineNode[]

  const virtualEdges: Edge[] = []
  for (const e of edges) {
    if (aiNodeIds.has(e.source)) continue
    if (aiNodeIds.has(e.target)) {
      const aiOutEdge = edges.find(e2 => e2.source === e.target)
      if (aiOutEdge && !aiNodeIds.has(aiOutEdge.target)) {
        virtualEdges.push({ ...e, target: aiOutEdge.target, id: `v-${e.id}` })
      }
      continue
    }
    virtualEdges.push(e)
  }

  // BFS 從無 incoming edge 的節點開始
  const hasIncoming = new Set(virtualEdges.map(e => e.target))
  const starts = stepNodes.filter(n => !hasIncoming.has(n.id))
  if (!starts.length) {
    return [...stepNodes].sort((a, b) => a.position.x - b.position.x).map(n => n.data)
  }

  const adj = new Map<string, string>()
  virtualEdges.forEach(e => adj.set(e.source, e.target))

  const ordered: PipelineNode[] = []
  let cur: string | undefined = starts[0].id
  const visited = new Set<string>()
  while (cur && !visited.has(cur)) {
    visited.add(cur)
    const node = stepNodes.find(n => n.id === cur)
    if (node) ordered.push(node)
    cur = adj.get(cur)
  }

  // Include any disconnected nodes (sort by x)
  const disconnected = stepNodes.filter(n => !visited.has(n.id)).sort((a, b) => a.position.x - b.position.x)

  return [...ordered, ...disconnected].map((n, i) => {
    const aiData = aiDataByPredecessor.get(n.id)
    const d = n.data as StepData
    return {
      name: d.name,
      batch: d.batch,
      workingDir: d.workingDir || '',
      outputPath: (aiData?.targetPath && !d.outputPath) ? aiData.targetPath : d.outputPath,
      expect: aiData?.expectText || d.expect,
      skillMode: aiData?.skillMode || d.skillMode || false,
      timeout: d.timeout,
      retry: d.retry,
      index: i,
      status: d.status,
      errorMsg: d.errorMsg,
    } as StepData
  })
}

// ── Steps → YAML string ───────────────────────────────────────────────────────
export function stepsToYaml(name: string, validate: boolean, steps: StepData[]): string {
  // 有任何步驟含 expect 描述時，自動啟用 AI 驗證
  const hasExpect = steps.some(s => !!s.expect)
  const finalValidate = validate || hasExpect
  const lines: string[] = [
    `name: ${name || 'my-pipeline'}`,
    `validate: ${finalValidate}`,
    ``,
    `steps:`,
  ]
  for (const s of steps) {
    lines.push(`  - name: ${s.name}`)
    if (s.workingDir) lines.push(`    working_dir: ${s.workingDir}`)
    // batch: 多行用 YAML literal block (|)
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
    // 支援兩種格式：有 "pipeline:" 包裝 或 直接 "name: / steps:"
    // 先偵測縮排基準：找第一個 "- name:" 的前導空格數
    const lines = raw.split('\n')
    let stepIndent = 2  // 預設 2 空格
    for (const line of lines) {
      const m = line.match(/^(\s*)- name:/)
      if (m) { stepIndent = m[1].length; break }
    }
    const propIndent = stepIndent + 2  // batch, timeout 等屬性
    const subIndent  = propIndent + 2  // output.path, output.expect

    let name = 'my-pipeline'
    let validate = false
    const steps: StepData[] = []
    let cur: Partial<StepData> | null = null
    let inOutput = false
    // 追蹤多行 literal block (|) 的狀態
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

      // 處理多行 literal block 的續行
      if (multilineTarget) {
        // 空行保留在多行區塊中
        if (t === '') { multilineLines.push(''); continue }
        // 計算當前行前導空格
        const leadingSpaces = line.match(/^(\s*)/)?.[1].length ?? 0
        if (leadingSpaces >= multilineIndent) {
          multilineLines.push(line.slice(multilineIndent))
          continue
        }
        // 縮排回退，結束多行區塊
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
          // 開始多行區塊，找下一行的縮排作為基準
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
        // ai_validation: true → 啟用驗證（expect 由 description 填入）
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
