import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Edge } from '@xyflow/react'
import type { AppNode } from './_helpers'

// ── 一個工作流的完整資料 ─────────────────────────────────────────────────────
export interface Workflow {
  id: string
  name: string
  nodes: AppNode[]
  edges: Edge[]
  validate: boolean
  updatedAt: number
}

function makeId() { return `wf-${Date.now()}` }

function defaultWorkflow(name = '新工作流'): Workflow {
  return {
    id: makeId(),
    name,
    nodes: [],
    edges: [],
    validate: false,
    updatedAt: Date.now(),
  }
}

// ── Store ────────────────────────────────────────────────────────────────────
interface WorkflowStore {
  workflows: Workflow[]
  activeId:  string | null

  // CRUD
  createWorkflow: (name?: string) => string          // returns new id
  updateWorkflow: (id: string, patch: Partial<Omit<Workflow, 'id'>>) => void
  removeWorkflow: (id: string) => void
  setActive:      (id: string) => void
  getActive:      () => Workflow | undefined

  // 儲存目前畫布狀態
  saveCanvas: (id: string, nodes: AppNode[], edges: Edge[]) => void
}

export const useWorkflowStore = create<WorkflowStore>()(
  persist(
    (set, get) => ({
      workflows: [],
      activeId:  null,

      createWorkflow: (name) => {
        const wf = defaultWorkflow(name)
        set(s => ({ workflows: [...s.workflows, wf], activeId: wf.id }))
        return wf.id
      },

      updateWorkflow: (id, patch) =>
        set(s => ({
          workflows: s.workflows.map(w =>
            w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w
          ),
        })),

      removeWorkflow: (id) =>
        set(s => {
          const ws      = s.workflows.filter(w => w.id !== id)
          const activeId = s.activeId === id ? (ws[ws.length - 1]?.id ?? null) : s.activeId
          return { workflows: ws, activeId }
        }),

      setActive: (id) => set({ activeId: id }),

      getActive: () => {
        const { workflows, activeId } = get()
        return workflows.find(w => w.id === activeId)
      },

      saveCanvas: (id, nodes, edges) =>
        set(s => ({
          workflows: s.workflows.map(w =>
            w.id === id ? { ...w, nodes, edges, updatedAt: Date.now() } : w
          ),
        })),
    }),
    {
      name: 'pipeline-workflows-v1',
      // 只序列化需要的欄位（排除函式）
      partialize: (s) => ({ workflows: s.workflows, activeId: s.activeId }),
    }
  )
)
