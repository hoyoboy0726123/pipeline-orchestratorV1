"""
Pipeline YAML 設定模型。

範例 YAML：
  pipeline:
    name: 每日資料處理
    steps:
      - name: 資料抓取
        batch: python fetch_data.py
        timeout: 300
        output:
          path: /data/raw.csv
          expect: "CSV 檔，至少 100 列，含 date、price 欄位"
        retry: 2

      - name: 資料分析
        batch: python analyze.py
        timeout: 600
        output:
          path: /data/report.xlsx
          expect: "Excel 檔，大小大於 10KB"
        retry: 1
"""
from typing import Optional
import yaml
from pydantic import BaseModel


class StepOutput(BaseModel):
    """輸出檔案的預期描述（用自然語言，LLM 負責驗證）"""
    path: Optional[str] = None
    expect: str = ""
    description: str = ""  # 同 expect 的別名，YAML 可用 description 代替
    ai_validation: bool = True  # YAML 可用 ai_validation: true 明確啟用
    skill_mode: bool = False  # True = 使用 Skill agent 主動驗證

    def get_expect(self) -> str:
        """取得驗證描述（優先 expect，fallback 到 description）"""
        return self.expect or self.description


class PipelineStep(BaseModel):
    name: str
    batch: str = ""       # Shell 命令（skill_mode 時可為自然語言描述）
    working_dir: str = ""  # 工作目錄（run_python/run_shell 的 cwd）
    timeout: int = 300    # 秒
    output: Optional[StepOutput] = None
    retry: int = 1        # 自動重試次數（超過才問用戶）
    skill_mode: bool = False  # True = batch 為自然語言，由 LLM Skill agent 執行
    skill: str = ""            # 掛載的 Claude Code skill 名稱（~/.agents/skills/ 下的資料夾名）
    readonly: bool = False  # True = 唯讀驗證模式，禁止修改檔案
    ask_mode: bool = False  # True = 詢問模式：LLM 遇到任何不確定就主動 ask_user 問用戶
    human_confirm: bool = False  # True = 人工確認節點，暫停等待確認
    message: str = ""            # 人工確認時的自訂訊息
    notify_telegram: bool = True  # 人工確認時是否發 Telegram
    screenshot: bool = False     # True = 暫停前自動截圖，附帶到 Telegram


class PipelineConfig(BaseModel):
    name: str
    steps: list[PipelineStep]
    validate: bool = True  # False = 跳過 LLM 驗證，僅靠 exit code

    @classmethod
    def from_yaml(cls, path: str) -> "PipelineConfig":
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        # 支援頂層有 "pipeline:" 或直接是 {name, steps}
        raw = data.get("pipeline", data)
        filtered = {k: v for k, v in raw.items() if not k.startswith("_")}
        return cls(**filtered)

    @classmethod
    def from_dict(cls, data: dict) -> "PipelineConfig":
        # 過濾掉非 schema 的內部旗標（如 _use_recipe）
        filtered = {k: v for k, v in data.items() if not k.startswith("_")}
        return cls(**filtered)
