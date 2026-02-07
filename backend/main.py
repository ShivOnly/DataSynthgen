"""
Main FastAPI application with improved error handling and routing.
"""

import json
import logging
from typing import List, Optional, Literal, Dict
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from groq import Groq

from config import get_settings, Settings
from synthetic_engine import generate_dataset
from schema_web_suggest import suggest_schema_from_web
from charts import router as charts_router
from reasoning import router as reasoning_router
from field_dependency import router as field_dependency_router

# -------------------------------------------------------------------
# Logging
# -------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# -------------------------------------------------------------------
# Lifespan context manager for startup/shutdown
# -------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle application startup and shutdown."""
    logger.info("Starting application...")
    settings = get_settings()
    env = getattr(settings, "environment", "local")
    model_name = getattr(settings, "model_name", "unknown-model")
    logger.info(f"Environment: {env}")
    logger.info(f"Model: {model_name}")
    yield
    logger.info("Shutting down application...")


# -------------------------------------------------------------------
# App initialization
# -------------------------------------------------------------------
app = FastAPI(
    title="Synthetic Data Generator API",
    description="API for generating synthetic datasets with AI/Web-based schema suggestions",
    version="2.0.0",
    lifespan=lifespan,
)

# Load settings once here (safe across reload worker)
settings = get_settings()

# ---- CORS with safe fallback if `cors_origins` is missing in Settings ----
try:
    allow_origins = settings.cors_origins  # type: ignore[attr-defined]
except AttributeError:
    allow_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
    logger.warning(
        "Settings has no 'cors_origins'. Using fallback: %s", allow_origins
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(charts_router, prefix="/api/charts", tags=["charts"])
app.include_router(reasoning_router, prefix="/api/reasoning", tags=["reasoning"])
app.include_router(field_dependency_router, prefix="/api", tags=["dependencies"])


# -------------------------------------------------------------------
# Pydantic Models
# -------------------------------------------------------------------
class FieldModel(BaseModel):
    """Field definition for dataset schema."""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(default="", max_length=500)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str):
        if not v.strip():
            raise ValueError("Field name cannot be empty")
        return v.strip()


class SchemaRequest(BaseModel):
    """Request for AI-based schema suggestion."""
    description: str = Field(..., min_length=1, max_length=1000)
    max_fields: Optional[int] = Field(default=6, ge=1, le=20)


class WebSchemaRequest(BaseModel):
    """Request for web-based schema suggestion."""
    description: str = Field(..., min_length=1, max_length=1000)
    max_fields: Optional[int] = Field(default=6, ge=1, le=20)


class GenerateRequest(BaseModel):
    """Request for dataset generation."""
    description: str = Field(..., min_length=1, max_length=1000)
    country: str = Field(default="hi_IN")
    rows: int = Field(..., ge=1, le=100)
    fields: List[FieldModel] = Field(..., min_items=1)

    generator: Literal["ai", "web"] = "ai"
    # For AI mode, dependency guidance (optional)
    relations: Optional[Dict[str, Dict[str, List[str]]]] = None

    @field_validator("fields")
    @classmethod
    def validate_fields(cls, v: List[FieldModel]):
        names = [f.name for f in v]
        if len(names) != len(set(names)):
            raise ValueError("Field names must be unique")
        return v


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
    status_code: int


# -------------------------------------------------------------------
# Exception Handlers
# -------------------------------------------------------------------
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error=exc.detail,
            status_code=exc.status_code,
        ).model_dump(),
    )


@app.exception_handler(Exception)
async def general_exception_handler(request, exc: Exception):
    logger.error(f"Unhandled exception: {str(exc)}", exc_info=True)
    debug = getattr(settings, "debug", True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=ErrorResponse(
            error="Internal server error",
            detail=str(exc) if debug else None,
            status_code=500,
        ).model_dump(),
    )


# -------------------------------------------------------------------
# API Endpoints
# -------------------------------------------------------------------
@app.get("/")
async def root():
    return {
        "name": "Synthetic Data Generator API",
        "version": "2.0.0",
        "status": "running",
        "endpoints": {
            "schema_ai": "/suggest-schema",
            "schema_web": "/suggest-schema-web",
            "generate": "/generate",
            "charts": "/api/charts/suggest-charts",
            "reasoning": "/api/reasoning/generate-reasoning",
            "dependencies": "/api/field-dependency/infer",
        },
    }


@app.get("/health")
async def health_check():
    env = getattr(settings, "environment", "local")
    return {"status": "healthy", "environment": env}


@app.post("/suggest-schema")
async def suggest_schema(
    request: SchemaRequest,
    settings: Settings = Depends(get_settings),
):
    try:
        logger.info(f"Generating AI schema for: {request.description[:50]}...")

        client = Groq(api_key=settings.groq_api_key)

        prompt = (
            f"Dataset goal: {request.description}. "
            f"Suggest exactly {request.max_fields} fields for this dataset. "
            f"Return JSON with 'fields' array containing objects with 'name' and 'description' keys. "
            f"Make field names concise, lowercase with underscores (snake_case). "
            f"Provide clear, helpful descriptions."
        )

        temperature = getattr(settings, "model_temperature", 0.2)

        completion = client.chat.completions.create(
            model=settings.model_name,
            messages=[
                {
                    "role": "system",
                    "content": "You are a data schema expert. Generate clear, well-structured field definitions.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=temperature,
            response_format={"type": "json_object"},
        )

        result = json.loads(completion.choices[0].message.content)
        logger.info(f"Generated {len(result.get('fields', []))} fields")
        return result

    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to parse AI response",
        )
    except Exception as e:
        logger.error(f"Schema generation error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Schema generation failed: {str(e)}",
        )


@app.post("/suggest-schema-web")
async def suggest_schema_web_endpoint(
    request: WebSchemaRequest,
    settings: Settings = Depends(get_settings),
):
    try:
        logger.info(f"Generating web schema for: {request.description[:50]}...")

        user_agent = getattr(
            settings,
            "wikipedia_user_agent",
            "DataSynthSchemaBot/1.0 (https://example.com/contact; mailto:dev@example.com)",
        )

        result = suggest_schema_from_web(
            description=request.description,
            max_fields=request.max_fields,
            user_agent=user_agent,
        )

        logger.info(f"Generated {len(result.get('fields', []))} fields from web")
        return result

    except Exception as e:
        logger.error(f"Web schema generation error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Web schema generation failed: {str(e)}",
        )


@app.post("/generate")
async def generate_data(
    req: GenerateRequest,
    settings: Settings = Depends(get_settings),
):
    try:
        logger.info(f"Generating {req.rows} rows for: {req.description[:50]}...")

        # Limit rows to configured maximum
        max_rows = min(req.rows, settings.max_rows)
        if max_rows != req.rows:
            logger.warning(f"Requested {req.rows} rows, limited to {max_rows}")

        # ✅ Honor requested generator ("ai" or "web")
        generator = req.generator

        # Convert fields to dict format (Pydantic v2)
        fields_dict = [f.model_dump() for f in req.fields]

        dataset = generate_dataset(
            generator=generator,
            fields=fields_dict,
            count=max_rows,
            description=req.description,
            locale=req.country,
            api_key=settings.groq_api_key,
            model=settings.model_name,
            relations=req.relations,  # used only by AI mode
        )

        logger.info(f"Successfully generated {len(dataset.get('rows', []))} rows")
        return dataset

    except Exception as e:
        logger.error(f"Data generation error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Data generation failed: {str(e)}",
        )


# -------------------------------------------------------------------
# Local run
# -------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )