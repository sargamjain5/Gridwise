"""
FastAPI server for the ANPR + Parking Violation Detection pipeline.

Run:

cd models

python server.py

Open:

http://localhost:8000
http://localhost:8000/docs
http://localhost:8000/health

Endpoints:

GET  /
GET  /health
POST /detect/image
POST /detect/video
"""

import os
import json
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

from anpr import ANPRPipeline


# --------------------------------------------------
# APP
# --------------------------------------------------

app = FastAPI(
    title="ANPR Parking Violation API",
    version="1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# PIPELINE
# --------------------------------------------------

_pipeline = None


def get_pipeline():

    global _pipeline

    if _pipeline is None:

        print("[INFO] Loading ANPR model...")

        _pipeline = ANPRPipeline(
            device="cpu"
        )

        print("[INFO] Model loaded.")

    return _pipeline


# --------------------------------------------------
# ROOT
# --------------------------------------------------

@app.get("/")
def home():

    return {

        "message": "ANPR Parking Violation API Running",

        "docs": "/docs",

        "health": "/health",

        "image_endpoint": "/detect/image",

        "video_endpoint": "/detect/video",

    }


# --------------------------------------------------
# HEALTH
# --------------------------------------------------

@app.get("/health")
def health():

    return {

        "status": "ok",

        "model_loaded": _pipeline is not None

    }


# --------------------------------------------------
# IMAGE DETECTION
# --------------------------------------------------

@app.post("/detect/image")
async def detect_image(

    file: UploadFile = File(...),

    violation_zones: str = Form(default=""),

):

    pipeline = get_pipeline()

    suffix = Path(

        file.filename or "upload.jpg"

    ).suffix

    with tempfile.NamedTemporaryFile(

        suffix=suffix,

        delete=False

    ) as tmp:

        content = await file.read()

        tmp.write(content)

        tmp_path = tmp.name

    try:

        zones = (

            json.loads(violation_zones)

            if violation_zones

            else None

        )

        result = pipeline.process_image(

            tmp_path,

            violation_zones=zones

        )

        return JSONResponse(

            content=result.to_dict()

        )

    except Exception as e:

        return JSONResponse(

            status_code=500,

            content={

                "error": str(e)

            }

        )

    finally:

        os.unlink(tmp_path)


# --------------------------------------------------
# VIDEO DETECTION
# --------------------------------------------------

@app.post("/detect/video")
async def detect_video(

    file: UploadFile = File(...),

    sample_fps: float = Form(default=2.0),

    max_frames: int = Form(default=50),

    violation_zones: str = Form(default=""),

):

    pipeline = get_pipeline()

    suffix = Path(

        file.filename or "upload.mp4"

    ).suffix

    with tempfile.NamedTemporaryFile(

        suffix=suffix,

        delete=False

    ) as tmp:

        content = await file.read()

        tmp.write(content)

        tmp_path = tmp.name

    try:

        zones = (

            json.loads(violation_zones)

            if violation_zones

            else None

        )

        result = pipeline.process_video(

            tmp_path,

            sample_fps=sample_fps,

            max_frames=max_frames,

            violation_zones=zones,

        )

        return JSONResponse(

            content=result.to_dict()

        )

    except Exception as e:

        return JSONResponse(

            status_code=500,

            content={

                "error": str(e)

            }

        )

    finally:

        os.unlink(tmp_path)


# --------------------------------------------------
# START SERVER
# --------------------------------------------------

if __name__ == "__main__":

    print()

    print("Starting ANPR Server")

    print()

    print("Home : http://localhost:8000")

    print("Docs : http://localhost:8000/docs")

    print("Health : http://localhost:8000/health")

    print()

    uvicorn.run(

        app,

        host="0.0.0.0",

        port=8000,

    )