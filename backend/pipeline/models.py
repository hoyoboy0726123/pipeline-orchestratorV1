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


class PipelineStep(BaseModel):
    name: str
    batch: str            # Shell 命令
    timeout: int = 300    # 秒
    output: Optional[StepOutput] = None
    retry: int = 1        # 自動重試次數（超過才問用戶）


class PipelineConfig(BaseModel):
    name: str
    steps: list[PipelineStep]
    validate: bool = True  # False = 跳過 LLM 驗證，僅靠 exit code

    @classmethod
    def from_yaml(cls, path: str) -> "PipelineConfig":
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        # 支援頂層有 "pipeline:" 或直接是 {name, steps}
        return cls(**data.get("pipeline", data))

    @classmethod
    def from_dict(cls, data: dict) -> "PipelineConfig":
        return cls(**data)
