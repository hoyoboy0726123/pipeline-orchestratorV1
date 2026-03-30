"""
Pipeline Run 狀態持久化（SQLite）。

每次 pipeline 執行建立一個 PipelineRun 記錄，
包含每步的執行結果與驗證結論，支援暫停後恢復。
"""
import json
import sqlite3
from dataclasses import dataclass, asdict, field
from datetime import datetime
from typing import Optional

from config import OUTPUT_BASE_PATH

PIPELINE_DB = str(OUTPUT_BASE_PATH / "pipeline_runs.db")


@dataclass
class StepResult:
    step_index: int
    step_name: str
    exit_code: int
    stdout_tail: str        # 最後 ~500 字（完整輸出在 log 檔）
    stderr_tail: str        # 最後 ~200 字
    validation_status: str  # "ok" | "warning" | "failed"
    validation_reason: str
    validation_suggestion: str
    retries_used: int = 0


@dataclass
class PipelineRun:
    run_id: str
    pipeline_name: str
    config_dict: dict
    current_step: int = 0
    step_results: list = field(default_factory=list)  # list[StepResult]
    status: str = "running"   # running | awaiting_human | completed | failed | aborted
    telegram_chat_id: Optional[int] = None
    log_path: str = ""
    started_at: str = field(default_factory=lambda: datetime.now().isoformat())
    ended_at: Optional[str] = None


class RunStore:
    def __init__(self):
        self._conn = sqlite3.connect(PIPELINE_DB, check_same_thread=False)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS pipeline_runs (
                run_id TEXT PRIMARY KEY,
                data   TEXT NOT NULL
            )
        """)
        self._conn.commit()

    def save(self, run: PipelineRun):
        raw = asdict(run)
        raw["step_results"] = [
            asdict(s) if isinstance(s, StepResult) else s
            for s in run.step_results
        ]
        self._conn.execute(
            "INSERT OR REPLACE INTO pipeline_runs VALUES (?, ?)",
            (run.run_id, json.dumps(raw, ensure_ascii=False)),
        )
        self._conn.commit()

    def load(self, run_id: str) -> Optional[PipelineRun]:
        row = self._conn.execute(
            "SELECT data FROM pipeline_runs WHERE run_id=?", (run_id,)
        ).fetchone()
        if not row:
            return None
        d = json.loads(row[0])
        d["step_results"] = [StepResult(**s) for s in d.get("step_results", [])]
        return PipelineRun(**d)

    def list_recent(self, limit: int = 10) -> list[PipelineRun]:
        rows = self._conn.execute(
            "SELECT data FROM pipeline_runs ORDER BY rowid DESC LIMIT ?", (limit,)
        ).fetchall()
        result = []
        for (data,) in rows:
            d = json.loads(data)
            d["step_results"] = [StepResult(**s) for s in d.get("step_results", [])]
            result.append(PipelineRun(**d))
        return result

    def delete(self, run_id: str) -> bool:
        cursor = self._conn.execute(
            "DELETE FROM pipeline_runs WHERE run_id=?", (run_id,)
        )
        self._conn.commit()
        return cursor.rowcount > 0

    def list_awaiting(self) -> list[PipelineRun]:
        """回傳所有正在等待人為決策的 run"""
        rows = self._conn.execute("SELECT data FROM pipeline_runs").fetchall()
        result = []
        for (data,) in rows:
            d = json.loads(data)
            if d.get("status") == "awaiting_human":
                d["step_results"] = [StepResult(**s) for s in d.get("step_results", [])]
                result.append(PipelineRun(**d))
        return result


_store: Optional[RunStore] = None


def get_store() -> RunStore:
    global _store
    if _store is None:
        _store = RunStore()
    return _store
