# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Pipeline Orchestrator** is a visual workflow automation system with a drag-and-drop canvas (React Flow) for designing multi-step pipelines. It supports three node types: shell script steps, AI-generated skill steps (LLM writes and executes Python code), and human confirmation gates. The backend uses FastAPI + SQLite; the frontend uses Next.js 14 App Router.

## Running the Project

### Backend
```bash
cd backend
# Activate venv first
source .venv/bin/activate          # macOS/Linux
.venv\Scripts\activate             # Windows CMD
.venv\Scripts\Activate.ps1        # Windows PowerShell

uvicorn main:app --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd frontend
npm run dev -- --port 3002
```

### One-click (Windows)
```bash
launch_full_project.bat
```

### One-click (Unix/macOS)
```bash
./start.sh
```

Access points:
- Frontend: http://localhost:3002
- Backend API: http://localhost:8000
- Swagger UI: http://localhost:8000/docs

### Frontend build/lint
```bash
cd frontend
npm run build
npm run lint
```

## Architecture

### Backend (`backend/`)

| File | Role |
|------|------|
| `main.py` | All REST API endpoints (FastAPI); ~830 lines |
| `config.py` | Env vars, output/pipeline directory setup, SQLite WAL mode |
| `llm_factory.py` | Multi-provider LLM client (Groq / Gemini / Ollama); streaming + timeout |
| `db.py` | Raw SQLite layer for workflows, recipes, and runs |
| `settings.py` | Persisted user settings (model choice, notification config) |
| `telegram_handler.py` | Telegram notifications + inline-keyboard polling for human confirm |
| `skill_pkg_manager.py` | Install/remove Python packages into the venv at runtime |
| `pipeline/runner.py` | State-machine orchestrator; drives per-step execution, retry, pause |
| `pipeline/executor.py` | Executes shell commands or AI-generated Python; handles skill code gen |
| `pipeline/validator.py` | AI-driven output validation after each step |
| `pipeline/recipe.py` | Recipe cache — if identical task + inputs, skip LLM and replay code |
| `pipeline/store.py` | Serialize/deserialize `PipelineRun` objects to/from SQLite |
| `pipeline/models.py` | `PipelineConfig`, `PipelineStep`, `PipelineRun`, `StepResult` dataclasses |
| `scheduler/manager.py` | APScheduler (cron/interval) backed by SQLite job store |

### Frontend (`frontend/`)

| Path | Role |
|------|------|
| `app/pipeline/page.tsx` | Main pipeline canvas editor (~1232 lines); React Flow wrapper |
| `app/pipeline/_store.ts` | Zustand store for canvas/pipeline state |
| `app/pipeline/_sidebar.tsx` | Node control panel (add/configure nodes) |
| `app/pipeline/_scriptPanel.tsx` | Script node config panel |
| `app/pipeline/_skillPanel.tsx` | Skill node config panel |
| `app/pipeline/_humanConfirmPanel.tsx` | Human confirm node panel |
| `app/settings/page.tsx` | LLM model selection, package management, Telegram settings |
| `app/recipes/page.tsx` | Browse and manage recipe cache |
| `lib/api.ts` | All backend API calls; single source of truth for HTTP communication |
| `lib/types.ts` | Shared TypeScript interfaces |

### Pipeline Execution Flow

```
POST /pipeline/run (YAML payload)
  → Parse PipelineConfig
  → PipelineRunner.run_pipeline()
    → For each step:
        Script step  → shell command via subprocess
        Skill step   → check recipe cache → (miss) LLM generates Python → exec
        Human confirm → send Telegram → poll for user response
        → validate_step() if AI validation enabled
        → retry or pause on failure
  → PipelineRun persisted; frontend polls GET /pipeline/runs/{run_id}
```

### Three Node Types (YAML)

```yaml
# Script node — run a shell command
- name: step1
  batch: "python script.py --input data.csv"

# Skill node — LLM generates code from description
- name: step2
  skill_mode: true
  batch: "Read data.csv and compute monthly averages, save to output.xlsx"

# Human confirm node — pause and wait for Telegram approval
- name: step3
  human_confirm: true
  batch: "Please review the output before continuing"
```

### Recipe Caching

Recipes are stored in `ai_output/pipeline.db` (`recipes` table). A recipe matches when:
1. The task description hash matches
2. Input file fingerprints (hashes) match

On a cache hit, the stored Python code is executed directly — no LLM call. Recipes track `success_count`, `fail_count`, and `avg_runtime_sec`.

### LLM Providers

Configured via `backend/.env` (copy from `.env.example`):
- **Groq** — `GROQ_API_KEY` (Llama 4 Scout, Llama 3.3 70B, DeepSeek R1, etc.)
- **Gemini** — `GEMINI_API_KEY` (Gemma 4 31B)
- **Ollama** — No key; local model; supports reasoning/thinking mode

Switch provider at runtime via `PUT /settings/model`.

### Database

SQLite at `~/ai_output/pipeline.db` (WAL mode). Three application tables:
- `workflows` — canvas JSON + YAML per workflow
- `recipes` — cached AI-generated code per workflow step
- `runs` — full JSON-serialized `PipelineRun` history

### Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `GROQ_API_KEY` | For Groq | — | Groq API access |
| `GEMINI_API_KEY` | For Gemini | — | Gemini API access |
| `TELEGRAM_BOT_TOKEN` | Optional | — | Human confirm notifications |
| `TELEGRAM_CHAT_ID` | Optional | — | Telegram target chat |
| `TIMEZONE` | No | `Asia/Taipei` | Cron scheduler timezone |
| `OUTPUT_BASE_PATH` | No | `~/ai_output` | Workflow output directory |
| `PIPELINE_DIR` | No | `~/pipelines` | Workflow definition directory |

## Key Conventions

- Frontend components internal to a page are prefixed with `_` (e.g., `_sidebar.tsx`, `_store.ts`).
- All backend HTTP calls go through `frontend/lib/api.ts` — add new calls there.
- The frontend proxies `/api/backend/*` to `http://localhost:8000` (configured in `next.config.mjs`).
- Default skill packages installed to venv: `pandas`, `openpyxl`, `matplotlib`, `requests`, `beautifulsoup4`, `Pillow`, `python-docx` (see `backend/skill_packages.txt`).
- UI and comments are predominantly in Chinese (Traditional, Taiwan locale).
