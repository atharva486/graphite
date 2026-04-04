from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Import the functions from the script next to it
from nlp_pipeline import get_suggestions, load_graph, build_sibling_map, VectorIndex

app = FastAPI()

# Allow Electron to talk to it
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables to hold the graph so it doesn't reload every click
current_graph = None
current_sibling_map = None
current_index = None

@app.post("/get-cards")
async def generate_cards(request: Request):
    global current_graph, current_sibling_map, current_index
    
    data = await request.json()
    node_id = data.get("node_id")
    visited_ids = data.get("visited_ids", [])
    json_path = data.get("json_path") 
    
    # Load the graph into memory if it's the first time
    if current_graph is None or data.get("reload_graph"):
        current_graph = load_graph(json_path)
        current_sibling_map = build_sibling_map(current_graph)
        current_index = VectorIndex(current_graph)
        
    # Run the pipeline!
    result = get_suggestions(
        node_id=node_id,
        visited_ids=visited_ids,
        graph=current_graph,
        sibling_map=current_sibling_map,
        index=current_index
    )
    
    return result

if __name__ == "__main__":
    # Run this separate engine on port 8005 (so it doesn't clash with anything else)
    uvicorn.run(app, host="0.0.0.0", port=8005)