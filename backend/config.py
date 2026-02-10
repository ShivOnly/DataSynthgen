from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache

class Settings(BaseSettings):
    
    groq_api_key: str
    
    model_name: str = "moonshotai/kimi-k2-instruct"
    
    default_country: str = "hi_IN" 
    
    
    max_columns: int = 6 
    max_rows: int = 20
    
    model_temperature: float = 0.2
    
    # extra="ignore" prevents crashes from unexpected .env keys
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

@lru_cache()
def get_settings():
    return Settings()