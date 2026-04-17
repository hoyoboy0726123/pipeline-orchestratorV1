"""
Pipeline Orchestrator — 獨立後端
啟動：uvicorn main:app --host 0.0.0.0 --port 8000
"""
import asyncio
import json
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File
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
    from db import init_db
    init_db()
    print("✅ SQLite 資料庫已初始化")
    # 自動安裝 skill_packages.txt 中缺少的套件
    from skill_pkg_manager import auto_install_packages
    auto_install_packages()
    await sched_start()
    print("✅ Pipeline Scheduler 已啟動")
    from telegram_handler import start_polling as tg_start
    await tg_start()
    print("✅ Telegram callback polling 已啟動")


@app.on_event("shutdown")
async def shutdown():
    await sched_shutdown()
    from telegram_handler import stop_polling as tg_stop
    await tg_stop()


# ── Health ───────────────────────────────────────────────────
@app.get("/health")
async def health():
    missing = check_config()
    return {"status": "ok", "warnings": [f"{k} 未設定" for k in missing]}


# ── Settings（模型選擇）─────────────────────────────────────
# 排除的 Groq 模型（非文字生成用途）
_GROQ_EXCLUDE_PREFIXES = ("whisper-", "llama-prompt-guard", "canopylabs/orpheus")

# Gemini 可用於文字生成的模型前綴（排除 embedding, tts, robotics, audio 等）
_GEMINI_TEXT_PREFIXES = ("gemini-2.5-", "gemini-2.0-", "gemini-3-", "gemini-3.", "gemma-")
_GEMINI_EXCLUDE_KEYWORDS = ("tts", "audio", "embedding", "robotics", "image", "live", "customtools", "computer-use")

# 支援思考模式的 Gemini 模型前綴
_GEMINI_THINKING_PREFIXES = ("gemini-2.5-", "gemini-3-", "gemini-3.")


@app.get("/settings/model")
async def get_model_settings():
    from settings import get_settings
    return get_settings()


class ModelSettingsRequest(BaseModel):
    provider: str
    model: str
    ollama_base_url: Optional[str] = None
    ollama_thinking: Optional[str] = None   # "auto" | "on" | "off"
    ollama_num_ctx: Optional[int] = None
    gemini_thinking: Optional[str] = None   # "off" | "auto" | "low" | "medium" | "high"
    openrouter_thinking: Optional[str] = None  # "off" | "on"


@app.put("/settings/model")
async def put_model_settings(req: ModelSettingsRequest):
    from settings import update_settings
    try:
        return update_settings(
            req.provider, req.model, req.ollama_base_url, req.ollama_thinking, req.ollama_num_ctx,
            req.gemini_thinking, req.openrouter_thinking,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/settings/models/available")
async def get_available_models():
    """動態列出各 provider 可用模型。"""
    import httpx
    from config import GROQ_API_KEY as _groq_key, GEMINI_API_KEY as _gemini_key, OPENROUTER_API_KEY as _or_key

    ollama_models: list[dict] = []
    ollama_error: Optional[str] = None
    groq_models: list[dict] = []
    groq_error: Optional[str] = None
    gemini_models: list[dict] = []
    gemini_error: Optional[str] = None
    openrouter_models: list[dict] = []
    openrouter_error: Optional[str] = None

    base_url = "http://localhost:11434"
    try:
        from settings import get_settings as _gs
        base_url = _gs().get("ollama_base_url") or base_url
    except Exception:
        pass

    async with httpx.AsyncClient(timeout=10.0) as client:
        # ── Groq（動態取得真實模型清單）──
        if _groq_key:
            try:
                r = await client.get(
                    "https://api.groq.com/openai/v1/models",
                    headers={"Authorization": f"Bearer {_groq_key}"},
                )
                r.raise_for_status()
                for m in r.json().get("data", []):
                    mid = m.get("id", "")
                    if not m.get("active", True):
                        continue
                    if any(mid.startswith(p) for p in _GROQ_EXCLUDE_PREFIXES):
                        continue
                    ctx = m.get("context_window", 0)
                    owner = m.get("owned_by", "")
                    label = mid
                    if owner:
                        label += f"（{owner}"
                        if ctx:
                            label += f", ctx={ctx // 1024}K"
                        label += "）"
                    groq_models.append({"id": mid, "label": label})
                groq_models.sort(key=lambda x: x["id"])
            except Exception as e:
                groq_error = f"Groq API 錯誤：{e}"
        else:
            groq_error = "未設定 GROQ_API_KEY"

        # ── Gemini（從 Google API 取得可用模型）──
        if _gemini_key:
            try:
                r = await client.get(
                    f"https://generativelanguage.googleapis.com/v1beta/models?key={_gemini_key}",
                )
                r.raise_for_status()
                for m in r.json().get("models", []):
                    mid = m.get("name", "").replace("models/", "")
                    if not any(mid.startswith(p) for p in _GEMINI_TEXT_PREFIXES):
                        continue
                    if any(kw in mid for kw in _GEMINI_EXCLUDE_KEYWORDS):
                        continue
                    display = m.get("displayName", mid)
                    supports_thinking = any(mid.startswith(p) for p in _GEMINI_THINKING_PREFIXES)
                    label = display
                    if supports_thinking:
                        label += "（支援思考）"
                    gemini_models.append({
                        "id": mid,
                        "label": label,
                        "supports_thinking": supports_thinking,
                    })
                gemini_models.sort(key=lambda x: x["id"])
            except Exception as e:
                gemini_error = f"Gemini API 錯誤：{e}"
        else:
            gemini_error = "未設定 GEMINI_API_KEY"

        # ── OpenRouter（免費模型）──
        try:
            r = await client.get("https://openrouter.ai/api/v1/models")
            r.raise_for_status()
            for m in r.json().get("data", []):
                pricing = m.get("pricing", {})
                if str(pricing.get("prompt", "1")) != "0" or str(pricing.get("completion", "1")) != "0":
                    continue
                mid = m.get("id", "")
                ctx = m.get("context_length", 0)
                name = m.get("name", mid)
                label = name
                if ctx:
                    label += f"（ctx={ctx // 1024}K）"
                openrouter_models.append({
                    "id": mid,
                    "label": label,
                    "context_length": ctx,
                })
            openrouter_models.sort(key=lambda x: x["id"])
        except Exception as e:
            openrouter_error = f"OpenRouter API 錯誤：{e}"

        # ── Ollama ──
        try:
            r = await client.get(f"{base_url.rstrip('/')}/api/tags", timeout=3.0)
            r.raise_for_status()
            for m in r.json().get("models", []):
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
        "groq": groq_models,
        "groq_error": groq_error,
        "gemini": gemini_models,
        "gemini_error": gemini_error,
        "openrouter": openrouter_models,
        "openrouter_error": openrouter_error,
        "ollama": ollama_models,
        "ollama_base_url": base_url,
        "ollama_error": ollama_error,
    }


# ── Skill Packages ──────────────────────────────────────────
@app.get("/settings/skill-packages")
async def get_skill_packages():
    from skill_pkg_manager import list_packages
    return {"packages": list_packages()}


class SkillPackageRequest(BaseModel):
    name: str


@app.post("/settings/skill-packages")
async def add_skill_package(req: SkillPackageRequest):
    from skill_pkg_manager import add_package
    ok, msg = add_package(req.name)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"message": msg}


@app.delete("/settings/skill-packages/{pkg_name}")
async def remove_skill_package(pkg_name: str):
    from skill_pkg_manager import remove_package
    ok, msg = remove_package(pkg_name)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"message": msg}


@app.get("/settings/skill-packages/unlisted")
async def scan_unlisted_skill_packages():
    """掃 venv 中已安裝但不在 skill_packages.txt 也不在 requirements.txt 的套件。"""
    from skill_pkg_manager import scan_unlisted_packages
    return {"packages": scan_unlisted_packages()}


class AdoptPackageRequest(BaseModel):
    name: str


@app.post("/settings/skill-packages/adopt")
async def adopt_existing_package(req: AdoptPackageRequest):
    """把已安裝的套件加入 skill_packages.txt（不再重新 install）。"""
    from skill_pkg_manager import add_to_list_only
    ok, msg = add_to_list_only(req.name)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"message": msg}


# ── Claude Code Skills（從 ~/.agents/skills/ 掃描）──────────
@app.get("/skills/available")
async def get_available_skills():
    """列出使用者安裝的 Claude Code skills（掃 ~/.agents/skills/）。"""
    from skill_scanner import list_available_skills, SKILLS_ROOT
    return {
        "skills_root": str(SKILLS_ROOT),
        "exists": SKILLS_ROOT.exists(),
        "skills": list_available_skills(),
    }


@app.get("/skills/{skill_name}/dependencies")
async def scan_skill_deps(skill_name: str):
    """掃描指定 skill 的 Python / Node.js 依賴。"""
    from skill_scanner import scan_skill_dependencies
    result = scan_skill_dependencies(skill_name)
    if not result.get("found"):
        raise HTTPException(status_code=404, detail=f"找不到 skill：{skill_name}")
    # 加上目前已安裝的 pip 套件，前端可對照
    # list_packages() 回傳 list[dict]，每個 dict 有 {name, installed, version}
    from skill_pkg_manager import list_packages
    installed_names = {p["name"].lower() for p in list_packages() if p.get("installed")}
    suggested = result["python"]["suggested_pip"]
    result["python"]["installed"] = sorted(s for s in suggested if s.lower() in installed_names)
    result["python"]["missing"] = [s for s in suggested if s.lower() not in installed_names]
    return result


# ── Notification Settings ──────────────────────────────────
class NotificationSettingsRequest(BaseModel):
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    line_notify_token: Optional[str] = None


@app.get("/settings/notifications")
async def get_notification_settings():
    from settings import get_settings
    s = get_settings()
    return {
        "telegram_bot_token": s.get("telegram_bot_token", ""),
        "telegram_chat_id": s.get("telegram_chat_id", ""),
        "line_notify_token": s.get("line_notify_token", ""),
    }


@app.put("/settings/notifications")
async def put_notification_settings(req: NotificationSettingsRequest):
    from settings import get_settings, _SETTINGS_PATH, _lock
    import json as _json
    import settings as _settings_mod
    s = get_settings()
    if req.telegram_bot_token is not None:
        s["telegram_bot_token"] = req.telegram_bot_token.strip()
    if req.telegram_chat_id is not None:
        s["telegram_chat_id"] = req.telegram_chat_id.strip()
    if req.line_notify_token is not None:
        s["line_notify_token"] = req.line_notify_token.strip()
    with _lock:
        _SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_SETTINGS_PATH, "w", encoding="utf-8") as f:
            _json.dump(s, f, ensure_ascii=False, indent=2)
        _settings_mod._cache = s
    return {
        "telegram_bot_token": s.get("telegram_bot_token", ""),
        "telegram_chat_id": s.get("telegram_chat_id", ""),
        "line_notify_token": s.get("line_notify_token", ""),
    }


# ── Workflows CRUD ──────────────────────────────────────────
class WorkflowRequest(BaseModel):
    name: str = "新工作流"
    canvas: Optional[dict] = None
    validate: bool = False


class WorkflowUpdateRequest(BaseModel):
    name: Optional[str] = None
    canvas: Optional[dict] = None
    validate: Optional[bool] = None
    yaml: Optional[str] = None


@app.get("/workflows")
async def api_list_workflows():
    from db import list_workflows
    return list_workflows()


@app.post("/workflows")
async def api_create_workflow(req: WorkflowRequest):
    from db import create_workflow
    return create_workflow(name=req.name, canvas=req.canvas, validate=req.validate)


@app.get("/workflows/{wf_id}")
async def api_get_workflow(wf_id: str):
    from db import get_workflow
    wf = get_workflow(wf_id)
    if not wf:
        raise HTTPException(status_code=404, detail="找不到工作流")
    return wf


@app.put("/workflows/{wf_id}")
async def api_update_workflow(wf_id: str, req: WorkflowUpdateRequest):
    from db import update_workflow
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    wf = update_workflow(wf_id, patch)
    if not wf:
        raise HTTPException(status_code=404, detail="找不到工作流")
    return wf


@app.delete("/workflows/{wf_id}")
async def api_delete_workflow(wf_id: str, cascade: bool = True):
    from db import delete_workflow
    delete_workflow(wf_id, cascade=cascade)
    return {"deleted": True, "cascade": cascade}


# ── Workflow Export / Import ─────────────────────────────────

@app.get("/workflows/{wf_id}/export")
async def api_export_workflow(wf_id: str):
    import io
    import zipfile
    from db import get_workflow, list_recipes
    from fastapi.responses import StreamingResponse

    wf = get_workflow(wf_id)
    if not wf:
        raise HTTPException(status_code=404, detail="找不到工作流")

    recipes = list_recipes(wf_id)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        # workflow.json
        wf_export = {
            "name": wf["name"],
            "canvas": wf["canvas"],
            "validate": wf["validate"],
            "yaml": wf.get("yaml", ""),
        }
        zf.writestr("workflow.json", json.dumps(wf_export, ensure_ascii=False, indent=2))

        # recipes/
        for r in recipes:
            recipe_data = {
                "step_name": r["step_name"],
                "task_hash": r["task_hash"],
                "input_fingerprints": r["input_fingerprints"],
                "output_path": r.get("output_path"),
                "code": r["code"],
                "python_version": r["python_version"],
                "success_count": r["success_count"],
                "avg_runtime_sec": r["avg_runtime_sec"],
            }
            safe_name = r["step_name"].replace("/", "_").replace("\\", "_")
            zf.writestr(f"recipes/{safe_name}.json", json.dumps(recipe_data, ensure_ascii=False, indent=2))

    buf.seek(0)
    from urllib.parse import quote
    safe_wf_name = wf["name"].replace(" ", "_").replace("/", "_")
    encoded_name = quote(safe_wf_name)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=\"workflow.zip\"; filename*=UTF-8''{encoded_name}.zip"},
    )


@app.post("/workflows/import")
async def api_import_workflow(file: UploadFile = File(...)):
    import io
    import zipfile
    from db import create_workflow, save_recipe

    content = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="無效的 ZIP 檔案")

    # 讀取 workflow.json
    if "workflow.json" not in zf.namelist():
        raise HTTPException(status_code=400, detail="ZIP 中找不到 workflow.json")

    wf_data = json.loads(zf.read("workflow.json"))

    # 自動避免重名：若已存在相同名稱則加 (1), (2)...
    from db import list_workflows
    existing_names = {w["name"] for w in list_workflows()}
    base_name = wf_data.get("name", "匯入的工作流")
    final_name = base_name
    counter = 1
    while final_name in existing_names:
        final_name = f"{base_name}({counter})"
        counter += 1

    wf = create_workflow(
        name=final_name,
        canvas=wf_data.get("canvas"),
        validate=wf_data.get("validate", False),
    )

    # 匯入 recipes
    recipe_count = 0
    for name in zf.namelist():
        if name.startswith("recipes/") and name.endswith(".json"):
            r = json.loads(zf.read(name))
            try:
                save_recipe(
                    workflow_id=wf["id"],
                    step_name=r["step_name"],
                    task_hash=r["task_hash"],
                    input_fingerprints=r.get("input_fingerprints", {}),
                    output_path=r.get("output_path"),
                    code=r.get("code", ""),
                    python_version=r.get("python_version", ""),
                    runtime_sec=r.get("avg_runtime_sec", 0),
                )
                recipe_count += 1
            except Exception:
                pass

    # 檢查是否有非 Skill 步驟（需要本地腳本）
    has_local_scripts = False
    nodes = wf_data.get("canvas", {}).get("nodes", [])
    for node in nodes:
        data = node.get("data", {})
        if not data.get("skillMode", False) and data.get("batch", "").strip():
            has_local_scripts = True
            break

    return {
        "workflow": wf,
        "recipe_count": recipe_count,
        "has_local_scripts": has_local_scripts,
    }


# ── Recipe Book ──────────────────────────────────────────────
@app.get("/recipes")
async def api_list_recipes(workflow_id: Optional[str] = None):
    from db import list_recipes
    return list_recipes(workflow_id)


@app.get("/recipes/status/{workflow_id}")
async def api_recipe_status(workflow_id: str, steps: str = ""):
    from db import get_recipe_status
    step_names = [s.strip() for s in steps.split(",") if s.strip()] if steps else []
    return get_recipe_status(workflow_id, step_names)


@app.delete("/recipes/{workflow_id}/{step_name}")
async def api_delete_recipe(workflow_id: str, step_name: str):
    from db import delete_recipe
    ok = delete_recipe(workflow_id, step_name)
    return {"deleted": ok}


@app.delete("/recipes/{workflow_id}")
async def api_delete_workflow_recipes(workflow_id: str):
    from db import delete_workflow_recipes
    count = delete_workflow_recipes(workflow_id)
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
    import os as _os
    venv_subdir = "Scripts" if _os.name == "nt" else "bin"
    venv_python = target / ".venv" / venv_subdir / ("python.exe" if _os.name == "nt" else "python")
    if venv_python.exists():
        return {"has_venv": True, "python_path": str(venv_python)}
    return {"has_venv": False, "python_path": None}


# ── Log Analysis ──────────────────────────────────────────────
# 常見 module → pip 套件名稱對映（module 名與 pip 名不同的情況）
_MODULE_TO_PIP = {
    "cv2": "opencv-python", "PIL": "Pillow", "bs4": "beautifulsoup4",
    "sklearn": "scikit-learn", "yaml": "pyyaml", "docx": "python-docx",
    "pptx": "python-pptx", "dotenv": "python-dotenv", "jwt": "pyjwt",
    "gi": "pygobject", "Crypto": "pycryptodome", "serial": "pyserial",
    "usb": "pyusb", "magic": "python-magic", "dateutil": "python-dateutil",
    "attr": "attrs", "lxml": "lxml", "wx": "wxPython",
}


@app.get("/pipeline/logs/analyze")
async def analyze_logs(count: int = 5):
    """掃描最近 N 筆 pipeline log，找出 ModuleNotFoundError / ImportError 並建議套件"""
    from pipeline.logger import LOG_DIR
    import re

    log_files = sorted(Path(LOG_DIR).glob("*.log"), key=lambda f: f.stat().st_mtime, reverse=True)[:count]

    missing: dict[str, dict] = {}  # module_name → { pip, files }
    pattern = re.compile(
        r"(?:ModuleNotFoundError:\s*No module named\s*['\"]([^'\"]+)['\"]"
        r"|ImportError:\s*cannot import name\s*['\"]?\w+['\"]?\s*from\s*['\"]([^'\"]+)['\"]"
        r"|ImportError:\s*No module named\s*['\"]([^'\"]+)['\"])"
    )

    analyzed_files = []
    for lf in log_files:
        text = lf.read_text(encoding="utf-8", errors="ignore")
        found_in_file = False
        for m in pattern.finditer(text):
            raw = m.group(1) or m.group(2) or m.group(3)
            top_module = raw.split(".")[0]
            pip_name = _MODULE_TO_PIP.get(top_module, top_module)
            if top_module not in missing:
                missing[top_module] = {"pip": pip_name, "files": []}
            if lf.name not in missing[top_module]["files"]:
                missing[top_module]["files"].append(lf.name)
            found_in_file = True
        analyzed_files.append({
            "name": lf.name,
            "size": lf.stat().st_size,
            "has_errors": found_in_file,
        })

    suggestions = [
        {"module": mod, "pip_name": info["pip"], "found_in": info["files"]}
        for mod, info in sorted(missing.items())
    ]

    return {"analyzed": len(log_files), "files": analyzed_files, "suggestions": suggestions}


# ── Pipeline Run ─────────────────────────────────────────────
class PipelineRunRequest(BaseModel):
    yaml_content: str
    validate: bool = True
    use_recipe: bool = False  # True = 快速模式：recipe 命中時跳過 LLM 驗證
    workflow_id: Optional[str] = None  # 關聯工作流 ID
    no_save_recipe: bool = False  # True = 延遲 recipe 儲存，等用戶確認


class PipelineDecisionRequest(BaseModel):
    decision: str  # retry | skip | abort | continue | retry_with_hint
    hint: Optional[str] = None  # 補充指示（retry_with_hint 時使用）


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
    config_d = config.model_dump()
    config_d["_use_recipe"] = req.use_recipe  # 傳遞快速模式旗標
    config_d["_workflow_id"] = req.workflow_id  # 關聯工作流
    config_d["_no_save_recipe"] = req.no_save_recipe  # 延遲 recipe 儲存
    run = PRun(
        run_id=run_id,
        pipeline_name=config.name,
        config_dict=config_d,
        telegram_chat_id=0,
        log_path=log_path,
        workflow_id=req.workflow_id,
    )
    get_store().save(run)

    # 背景執行（runner 看到已存在的 run_id 會恢復執行）
    from pipeline.runner import register_task
    task = asyncio.create_task(run_pipeline(config_d, chat_id=0, run_id=run_id))
    register_task(run_id, task)

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
    if req.decision not in ("retry", "skip", "abort", "continue", "retry_with_hint"):
        raise HTTPException(status_code=400, detail="decision 必須是 retry / skip / abort / continue / retry_with_hint")
    from pipeline.runner import resume_pipeline
    msg = await resume_pipeline(run_id, req.decision, hint=req.hint or "")
    return {"message": msg}


@app.post("/pipeline/runs/{run_id}/abort")
async def abort_pipeline_run(run_id: str):
    """立即中止正在執行的 pipeline（kill 子進程 + cancel task）"""
    from pipeline.store import get_store
    from pipeline.runner import force_abort
    run = get_store().load(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="找不到 pipeline run")
    if run.status not in ("running", "awaiting_human"):
        raise HTTPException(status_code=400, detail=f"Pipeline 狀態為 {run.status}，無法中止")
    await force_abort(run_id)
    return {"message": "⛔ Pipeline 已立即中止"}


@app.post("/pipeline/runs/{run_id}/save-recipes")
async def save_pending_recipes(run_id: str):
    """用戶確認後，將延遲儲存的 recipes 寫入 DB"""
    from pipeline.store import get_store
    from db import save_recipe as _db_save_recipe
    store = get_store()
    run = store.load(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="找不到 pipeline run")
    if not run.pending_recipes:
        return {"saved": 0}
    saved = 0
    for r in run.pending_recipes:
        try:
            _db_save_recipe(
                r["pipeline_id"], r["step_name"], r["task_hash"],
                r["input_fingerprints"], r["output_path"], r["code"],
                r["python_version"], r["runtime_sec"],
            )
            saved += 1
        except Exception:
            pass
    run.pending_recipes = []
    store.save(run)
    return {"saved": saved}


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


@app.delete("/pipeline/scheduled/cancel-by-name/{name}")
async def cancel_pipeline_schedule(name: str):
    from scheduler.manager import remove_task_by_name
    success = remove_task_by_name(name)
    if not success:
        raise HTTPException(status_code=404, detail="找不到該名稱的排程任務")
    return {"status": "ok"}


class PipelineScheduleRequest(BaseModel):
    name: str
    yaml_content: str
    schedule_type: str = "cron"
    schedule_expr: str = "0 8 * * *"
    validate: bool = True
    use_recipe: bool = False
    workflow_id: Optional[str] = None


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
        PipelineConfig(**{k: v for k, v in config_dict.items() if not k.startswith("_")})
        config_dict["_use_recipe"] = req.use_recipe
        if req.workflow_id:
            config_dict["_workflow_id"] = req.workflow_id
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

## 兩種步驟類型（最重要）

本系統支援兩種節點：
1. **腳本節點（script）**：使用者已經有寫好的腳本/指令 → `batch` 填路徑或指令
2. **技能節點（skill）**：使用者沒有腳本，想請 AI 自動撰寫程式碼執行 → `batch` 填**自然語言任務描述**，並加 `skill_mode: true`

**判斷原則**：
- 若使用者提到「抓取某網站」「生成某檔案」「處理資料」但**沒提到現成腳本路徑** → 直接用 **skill 節點**，不要問腳本路徑！
- 若使用者明確說「我有一個腳本在 xxx」或「跑我寫好的 yyy.py」 → 用 **script 節點**
- 不確定就用 **skill 節點**（AI 會自己寫程式碼）

## 你的任務

1. 資訊不足時用繁體中文反問，一次只問最重要的一個問題
   - 對 skill 節點，只需問：任務目標、輸出檔案路徑（可選）、有無特殊要求
   - **不要問使用者腳本路徑**除非他明確表示已有腳本
2. 收集足夠資訊後輸出完整 YAML（必須包含 `YAML_READY` 標記）

## 回覆格式

好的，我已經整理好 Pipeline 設定：

YAML_READY
```yaml
pipeline:
  name: yahoo_news_to_excel
  steps:
    - name: 抓取並匯出Excel
      skill_mode: true
      batch: |
        到 Yahoo 新聞首頁抓取 10 則頭條新聞，
        擷取每則的標題、內容摘要、來源網址，
        製作成 Excel 檔案，欄位依序為：標題、摘要、來源網址。
      timeout: 600
      retry: 2
      output:
        path: /Users/hadytang/ai_output/yahoo_news.xlsx
        expect: "Excel 檔案含 10 列新聞，三欄：標題、摘要、來源網址"
```

## YAML 欄位規則

- **skill_mode: true** → `batch` 為自然語言任務描述（多行用 `|`），AI 會自動寫 Python 程式碼
- **skill_mode 省略或 false** → `batch` 為 shell 指令或腳本路徑
- `timeout`：秒數，skill 節點建議 600，script 節點建議 300
- `retry`：失敗自動重試次數，建議 1-3
- `output.path`：預期產出的檔案絕對路徑（沒有就省略整個 `output`）
- `output.expect`：自然語言描述「正確輸出長什麼樣子」，供 AI 驗證"""


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
    raw = response.content
    # Gemini/Gemma 可能回傳 list of content blocks（含 thinking + text）→ 抽出 text
    if isinstance(raw, list):
        parts = []
        for block in raw:
            if isinstance(block, dict):
                if block.get("type") == "text" and block.get("text"):
                    parts.append(block["text"])
            elif isinstance(block, str):
                parts.append(block)
        content = "".join(parts)
    else:
        content = str(raw) if raw is not None else ""
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
        "pending_recipes": getattr(r, 'pending_recipes', []) or [],
        "awaiting_type": getattr(r, 'awaiting_type', '') or '',
        "awaiting_message": getattr(r, 'awaiting_message', '') or '',
        "awaiting_suggestion": getattr(r, 'awaiting_suggestion', '') or '',
    }
