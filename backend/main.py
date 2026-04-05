"""
Pipeline Orchestrator — 獨立後端
啟動：uvicorn main:app --host 0.0.0.0 --port 8002
"""
import asyncio
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import check_config
from scheduler.manager import start as sched_start, shutdown as sched_shutdown

app = FastAPI(title="Pipeline Orchestrator", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3002", "http://127.0.0.1:3002",
                   "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await sched_start()
    print("✅ Pipeline Scheduler 已啟動")


@app.on_event("shutdown")
async def shutdown():
    await sched_shutdown()


# ── Health ───────────────────────────────────────────────────
@app.get("/health")
async def health():
    missing = check_config()
    return {"status": "ok", "warnings": [f"{k} 未設定" for k in missing]}


# ── Settings（模型選擇）─────────────────────────────────────
# Groq 平台可選模型（2025 現役列表，按推理能力排序）
_GROQ_MODEL_PRESETS = [
    {"id": "meta-llama/llama-4-scout-17b-16e-instruct", "label": "Llama 4 Scout 17B（目前預設）"},
    {"id": "meta-llama/llama-4-maverick-17b-128e-instruct", "label": "Llama 4 Maverick 17B（更強推理）"},
    {"id": "llama-3.3-70b-versatile", "label": "Llama 3.3 70B Versatile（推理強）"},
    {"id": "llama-3.1-8b-instant", "label": "Llama 3.1 8B Instant（最快，最省配額）"},
    {"id": "moonshotai/kimi-k2-instruct", "label": "Kimi K2 Instruct（code 強）"},
    {"id": "deepseek-r1-distill-llama-70b", "label": "DeepSeek R1 Distill 70B（推理型）"},
    {"id": "qwen/qwen3-32b", "label": "Qwen3 32B"},
    {"id": "openai/gpt-oss-120b", "label": "GPT-OSS 120B"},
    {"id": "openai/gpt-oss-20b", "label": "GPT-OSS 20B"},
]


@app.get("/settings/model")
async def get_model_settings():
    from settings import get_settings
    return get_settings()


class ModelSettingsRequest(BaseModel):
    provider: str
    model: str
    ollama_base_url: Optional[str] = None
    ollama_thinking: Optional[str] = None  # "auto" | "on" | "off"
    ollama_num_ctx: Optional[int] = None


@app.put("/settings/model")
async def put_model_settings(req: ModelSettingsRequest):
    from settings import update_settings
    try:
        return update_settings(
            req.provider, req.model, req.ollama_base_url, req.ollama_thinking, req.ollama_num_ctx
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/settings/models/available")
async def get_available_models():
    """列出 Groq 預設模型 + 本機 Ollama 可用模型。"""
    ollama_models: list[dict] = []
    ollama_error: Optional[str] = None
    base_url = "http://localhost:11434"
    try:
        from settings import get_settings as _gs
        base_url = _gs().get("ollama_base_url") or base_url
    except Exception:
        pass

    try:
        import httpx
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{base_url.rstrip('/')}/api/tags")
            r.raise_for_status()
            data = r.json()
            for m in data.get("models", []):
                name = m.get("name") or m.get("model")
                if not name:
                    continue
                size = m.get("size", 0)
                size_gb = f"{size / 1024 / 1024 / 1024:.1f} GB" if size else ""
                ollama_models.append({
                    "id": name,
                    "label": f"{name}" + (f"（{size_gb}）" if size_gb else ""),
                })
    except Exception as e:
        ollama_error = f"無法連線 Ollama（{base_url}）：{e}"

    return {
        "groq": _GROQ_MODEL_PRESETS,
        "ollama": ollama_models,
        "ollama_base_url": base_url,
        "ollama_error": ollama_error,
    }


# ── Recipe Book ──────────────────────────────────────────────
@app.get("/recipes")
async def list_all_recipes():
    from pipeline.recipe import list_recipes
    return list_recipes()


@app.delete("/recipes/{pipeline_name}/{step_name}")
async def delete_one_recipe(pipeline_name: str, step_name: str):
    from pipeline.recipe import delete_recipe
    ok = delete_recipe(pipeline_name, step_name)
    return {"deleted": ok}


@app.delete("/recipes/{pipeline_name}")
async def delete_pipeline_all_recipes(pipeline_name: str):
    from pipeline.recipe import delete_pipeline_recipes
    count = delete_pipeline_recipes(pipeline_name)
    return {"deleted_count": count}


# ── File System Browser ──────────────────────────────────────
@app.get("/fs/browse")
async def fs_browse(path: str = ""):
    home = Path.home()
    target = Path(path).expanduser() if path else home
    try:
        target.resolve().relative_to(home.resolve())
    except ValueError:
        target = home
    if not target.exists() or not target.is_dir():
        target = home

    items = []
    try:
        for item in sorted(target.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            if item.name.startswith('.'):
                continue
            items.append({"name": item.name, "path": str(item), "is_dir": item.is_dir(), "ext": item.suffix.lower() if item.is_file() else ""})
    except PermissionError:
        pass

    parent = str(target.parent) if target != home else None
    return {"path": str(target), "parent": parent, "items": items}


@app.get("/fs/check-venv")
async def fs_check_venv(dir: str):
    target = Path(dir).expanduser().resolve()
    try:
        target.relative_to(Path.home().resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="只允許在 home 目錄下操作")
    venv_python = target / ".venv" / "bin" / "python"
    if venv_python.exists():
        return {"has_venv": True, "python_path": str(venv_python)}
    return {"has_venv": False, "python_path": None}


# ── Pipeline Run ─────────────────────────────────────────────
class PipelineRunRequest(BaseModel):
    yaml_content: str
    validate: bool = True


class PipelineDecisionRequest(BaseModel):
    decision: str  # retry | skip | abort


@app.post("/pipeline/run")
async def start_pipeline(req: PipelineRunRequest):
    import uuid, yaml
    from pipeline.models import PipelineConfig
    from pipeline.runner import run_pipeline
    from pipeline.store import PipelineRun as PRun, get_store
    from pipeline.logger import create_run_logger
    try:
        import logging as _logging
        _log = _logging.getLogger("pipeline")
        _log.debug(f"收到 YAML（{len(req.yaml_content)} 字元）:\n{req.yaml_content}")
        data = yaml.safe_load(req.yaml_content)
        config_dict = data.get("pipeline", data)
        config_dict["validate"] = req.validate
        config = PipelineConfig(**config_dict)
        for i, s in enumerate(config.steps):
            _log.debug(f"步驟[{i}] batch（{len(s.batch)} 字元）：{s.batch[:300]}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"YAML 解析失敗：{e}")

    # 先建立 run 並存入 store，確保前端立刻能查詢
    run_id = str(uuid.uuid4())[:12]
    _, log_path = create_run_logger(run_id, config.name)
    run = PRun(
        run_id=run_id,
        pipeline_name=config.name,
        config_dict=config.model_dump(),
        telegram_chat_id=0,
        log_path=log_path,
    )
    get_store().save(run)

    # 背景執行（runner 看到已存在的 run_id 會恢復執行）
    asyncio.create_task(run_pipeline(config.model_dump(), chat_id=0, run_id=run_id))

    return {"run_id": run_id, "message": f"Pipeline '{config.name}' 已啟動"}


@app.get("/pipeline/runs")
async def list_pipeline_runs():
    from pipeline.store import get_store
    runs = get_store().list_recent(20)
    return {"runs": [_run_to_dict(r) for r in runs]}


@app.get("/pipeline/runs/{run_id}")
async def get_pipeline_run(run_id: str):
    from pipeline.store import get_store
    run = get_store().load(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="找不到 pipeline run")
    return _run_to_dict(run)


@app.delete("/pipeline/runs/{run_id}")
async def delete_pipeline_run(run_id: str):
    from pipeline.store import get_store
    if get_store().delete(run_id):
        return {"message": f"Run {run_id} 已刪除"}
    raise HTTPException(status_code=404, detail="找不到該 run")


@app.post("/pipeline/runs/{run_id}/resume")
async def resume_pipeline_run(run_id: str, req: PipelineDecisionRequest):
    if req.decision not in ("retry", "skip", "abort"):
        raise HTTPException(status_code=400, detail="decision 必須是 retry / skip / abort")
    from pipeline.runner import resume_pipeline
    msg = await resume_pipeline(run_id, req.decision)
    return {"message": msg}


@app.get("/pipeline/runs/{run_id}/log")
async def get_pipeline_log(run_id: str):
    from pipeline.store import get_store
    run = get_store().load(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="找不到 pipeline run")
    log_path = Path(run.log_path)
    if not log_path.exists():
        return {"log": "（尚無 log 檔案）"}
    content = log_path.read_text(encoding="utf-8")
    return {"log": content}


# ── Pipeline Schedule ────────────────────────────────────────
@app.get("/pipeline/scheduled")
async def list_pipeline_scheduled():
    from scheduler.manager import list_tasks
    tasks = list_tasks()
    return {"tasks": [t for t in tasks if t.get("output_format") == "pipeline"]}


class PipelineScheduleRequest(BaseModel):
    name: str
    yaml_content: str
    schedule_type: str = "cron"
    schedule_expr: str = "0 8 * * *"
    validate: bool = True


@app.post("/pipeline/scheduled")
async def create_pipeline_schedule(req: PipelineScheduleRequest):
    import yaml
    from pipeline.models import PipelineConfig
    from scheduler.manager import add_pipeline_task
    from dataclasses import asdict
    try:
        data = yaml.safe_load(req.yaml_content)
        config_dict = data.get("pipeline", data)
        config_dict["validate"] = req.validate
        PipelineConfig(**config_dict)
        yaml_to_save = yaml.dump({"pipeline": config_dict}, allow_unicode=True, default_flow_style=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"YAML 格式錯誤：{e}")
    try:
        info = add_pipeline_task(name=req.name, schedule_type=req.schedule_type, schedule_expr=req.schedule_expr, yaml_content=yaml_to_save)
        return {"task": asdict(info)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/pipeline/scheduled/{task_id}")
async def delete_pipeline_schedule(task_id: str):
    from scheduler.manager import remove_task
    if remove_task(task_id):
        return {"message": f"排程 {task_id} 已刪除"}
    raise HTTPException(status_code=404, detail="找不到該排程")


# ── Pipeline YAML Chat Assistant ─────────────────────────────
_PIPELINE_SYSTEM = """你是 Pipeline YAML 設定助手。使用者會用自然語言描述他想自動化的工作流程。

你的任務：
1. 如果資訊不足，**用繁體中文反問**，一次只問一個最重要的問題
2. 收集到足夠資訊後（步驟名稱、執行命令/路徑、預期輸出），**輸出完整 YAML**

當你認為資訊足夠時，回覆格式如下（必須包含 YAML_READY 標記）：
好的，我已經整理好 Pipeline 設定：

YAML_READY
```yaml
pipeline:
  name: xxx
  steps:
    - name: 步驟名稱
      batch: /path/to/script.sh
      timeout: 300
      retry: 1
      output:
        path: /path/to/output.csv
        expect: "描述正確輸出的樣子"
```

YAML 規則：
- batch：Shell 命令或腳本路徑（Mac/Linux 用 .sh）
- timeout：秒數，不確定就預設 300
- retry：失敗自動重試次數，建議 1-3
- output.path：預期產出的檔案路徑（沒有輸出檔案可省略 output 欄位）
- output.expect：自然語言描述「正確輸出長什麼樣子」，AI 驗證用"""


class PipelineChatRequest(BaseModel):
    messages: list[dict]


@app.post("/pipeline/chat")
async def pipeline_chat(req: PipelineChatRequest):
    from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
    from llm_factory import build_llm
    import re

    llm = build_llm(temperature=0.3)
    lc_messages = [SystemMessage(content=_PIPELINE_SYSTEM)]
    for m in req.messages:
        cls = HumanMessage if m["role"] == "user" else AIMessage
        lc_messages.append(cls(content=m["content"]))

    response = llm.invoke(lc_messages)
    content = response.content
    has_yaml = "YAML_READY" in content
    yaml_content = None
    if has_yaml:
        match = re.search(r"```yaml\n([\s\S]+?)```", content)
        if match:
            yaml_content = match.group(1).strip()

    return {"reply": content, "has_yaml": has_yaml, "yaml_content": yaml_content}


# ── Helpers ──────────────────────────────────────────────────
def _run_to_dict(r):
    return {
        "run_id": r.run_id,
        "pipeline_name": r.pipeline_name,
        "status": r.status,
        "current_step": r.current_step,
        "total_steps": len(r.config_dict.get("steps", [])),
        "started_at": r.started_at,
        "ended_at": r.ended_at,
        "step_results": [
            {"step_index": s.step_index, "step_name": s.step_name, "exit_code": s.exit_code,
             "validation_status": s.validation_status, "validation_reason": s.validation_reason,
             "validation_suggestion": s.validation_suggestion, "retries_used": s.retries_used,
             "stdout_tail": s.stdout_tail, "stderr_tail": s.stderr_tail}
            for s in r.step_results
        ],
        "config_dict": r.config_dict,
        "log_path": r.log_path,
    }
