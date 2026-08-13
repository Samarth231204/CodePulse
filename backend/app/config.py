from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from typing import List
import json

class Settings(BaseSettings):
    postgres_user: str = Field(default="codepulse_user")
    postgres_password: str = Field(default="codepulse_password")
    postgres_db: str = Field(default="codepulse_dev")
    postgres_host: str = Field(default="db")
    postgres_port: int = Field(default=5432)
    database_url: str = Field(default="postgresql://codepulse_user:codepulse_password@db:5432/codepulse_dev")
    backend_port: int = Field(default=8000)
    backend_cors_origins: str = Field(default='["http://localhost:5173", "http://127.0.0.1:5173"]')
    
    @property
    def cors_origins(self) -> List[str]:
        try:
            return json.loads(self.backend_cors_origins)
        except Exception:
            return ["http://localhost:5173", "http://127.0.0.1:5173"]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
