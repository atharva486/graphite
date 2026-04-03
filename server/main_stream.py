from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import aiofiles
import uvicorn
import os

from extractor_stream import stream_hybrid

# --- Docling Imports ---
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.datamodel.base_models import InputFormat
from docling.datamodel.accelerator_options import AcceleratorOptions, AcceleratorDevice

# --- Lifespan Setup ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the GPU model once at startup
    print("🚀 Initializing Streaming Docling Engine on GPU...")
    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = False               
    pipeline_options.do_table_structure = False   
    pipeline_options.generate_page_images = False 
    
    pipeline_options.accelerator_options = AcceleratorOptions(
        num_threads=4, 
        device=AcceleratorDevice.CUDA 
    )
    
    app.state.converter = DocumentConverter(
        allowed_formats=[InputFormat.PDF],
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
        }
    )
    print("✅ Streaming Server Ready")
    yield

# --- App Initialization ---
app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/stream-scan")
async def stream_process_pdf(file: UploadFile = File(...)):
    temp_path = f"./temp_stream_{file.filename}"
    
    # Save uploaded file asynchronously
    async with aiofiles.open(temp_path, 'wb') as out_file:
        content = await file.read()
        await out_file.write(content)

    print(f"📥 Received for streaming: {file.filename}")

    # Inner async generator to stream chunks and cleanup afterward
    async def event_generator():
        try:
            # Yield events from our extractor
            async for chunk in stream_hybrid(temp_path, app.state.converter):
                yield chunk
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
                print(f"🗑️ Cleaned up {temp_path}")

    # Return the stream using the standard NDJSON media type
    return StreamingResponse(
        event_generator(), 
        media_type="application/x-ndjson"
    )

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002) # Using 8002 to avoid port conflicts