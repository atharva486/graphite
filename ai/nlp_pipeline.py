"""
NLP Pipeline — Curiosity Engine (5 Nodes)
========================================
Input  : node_id + visited_nodes[]
Output : 5 dynamic curiosity hooks (mapped to existing nodes or flagged as new)
"""

import json
import random
import os
import re
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.feature_extraction.text import TfidfVectorizer

# ─────────────────────────────────────────────
# 1. LOAD & INDEX THE JSON
# ─────────────────────────────────────────────

def load_graph(json_path: str) -> dict:
    with open(json_path) as f:
        raw = json.load(f)

    flat = {}

    # Mirror React's 'normalizeInput'
    if isinstance(raw, list):
        root_node = {
            "title": "Document",
            "page": raw[0].get("page", 1) if raw else 1,
            "level": 0,
            "type": "toc",
            "children": raw
        }
        nodes_to_traverse = [root_node]
    else:
        nodes_to_traverse = [raw]

    def traverse(nodes, parent_id=None, path_prefix=""):
        child_ids_list = []
        for i, node in enumerate(nodes):
            current_path = f"{path_prefix}{i}"
            node_id = f"node_{current_path}"
            
            node["id"] = node_id
            node["parent_id"] = parent_id
            
            if "content" not in node or not node["content"]:
                node["content"] = node.get("title", "")

            flat[node_id] = node
            child_ids_list.append(node_id)

            children = node.pop("children", [])
            node["child_ids"] = traverse(children, parent_id=node_id, path_prefix=f"{current_path}_")
            
        return child_ids_list

    traverse(nodes_to_traverse, parent_id=None, path_prefix="")
    return flat


def build_sibling_map(graph: dict) -> dict:
    sibling_map = {}
    for node_id, node in graph.items():
        parent_id = node.get("parent_id")
        if not parent_id or parent_id not in graph:
            sibling_map[node_id] = {"prev": None, "next": None}
            continue
        siblings = graph[parent_id].get("child_ids", [])
        idx = siblings.index(node_id) if node_id in siblings else -1
        sibling_map[node_id] = {
            "prev": siblings[idx - 1] if idx > 0 else None,
            "next": siblings[idx + 1] if idx < len(siblings) - 1 else None,
        }
    return sibling_map


# ─────────────────────────────────────────────
# 2. VECTOR INDEX (Semantic Matching)
# ─────────────────────────────────────────────

class VectorIndex:
    def __init__(self, graph: dict):
        self.graph = graph
        self.ids = list(graph.keys())
        texts = [
            f"{graph[i]['title']} {graph[i].get('content','')}"
            for i in self.ids
        ]
        self.vectorizer = TfidfVectorizer(stop_words="english", max_features=1000)
        self.matrix = self.vectorizer.fit_transform(texts)

    def search(self, query_text: str, top_k: int = 1, exclude_ids: list = None) -> list:
        exclude_ids = set(exclude_ids or [])
        query_vec = self.vectorizer.transform([query_text])
        scores = cosine_similarity(query_vec, self.matrix).flatten()

        results = []
        for idx, score in enumerate(scores):
            nid = self.ids[idx]
            if nid not in exclude_ids:
                results.append((nid, float(score)))

        results.sort(key=lambda x: x[1], reverse=True)
        return results[:top_k]

    def add_node(self, node: dict):
        self.graph[node["id"]] = node
        self.ids = list(self.graph.keys())
        texts = [
            f"{self.graph[i]['title']} {self.graph[i].get('content','')}"
            for i in self.ids
        ]
        self.matrix = self.vectorizer.fit_transform(texts)


# ─────────────────────────────────────────────
# 3. PROMPT BUILDER
# ─────────────────────────────────────────────

def build_prompt(current_node: dict, graph: dict, visited_ids: list, sibling_map: dict) -> str:
    recent_nodes = [graph[nid]["title"] for nid in visited_ids[-2:] if nid in graph]
    
    siblings = sibling_map.get(current_node["id"], {})
    sibling_titles = []
    if siblings.get("prev") and siblings["prev"] in graph:
        sibling_titles.append(graph[siblings["prev"]]["title"])
    if siblings.get("next") and siblings["next"] in graph:
        sibling_titles.append(graph[siblings["next"]]["title"])

    prompt = f"""SYSTEM ROLE:
You are the curiosity engine for a graph-based learning tool. Your only job is to generate exactly 5 node titles that make the user feel a question they NEED answered. You do not explain, teach, or elaborate. You name the next rabbit hole.

---
INPUT:

Current Node: "{current_node['title']}"
Content: {current_node.get('content', '')[:800]}

Recent Path (last 2 nodes): {json.dumps(recent_nodes)}

Existing Siblings: {json.dumps(sibling_titles)} ← never recommend these, zero exceptions

---
VOICE:
Each title must feel like a question the user's brain is already half-asking but hasn't articulated yet. Not a textbook heading. Not a YouTube tutorial title. The specific feeling: "wait, I never thought about that but now I have to know."

Good: "Why does your CPU lie to you about memory?"
Good: "The algorithm that beat human intuition at its own game"
Good: "What breaks when you push this idea to its limit?"
Bad: "Introduction to Cache Memory"
Bad: "Learn about Gradient Descent"
Bad: "Real-World Applications of B-Trees"

---
STYLES — allocate exactly 1 slot per style below:

1. Why?
Hook angle: The original problem that forced this idea into existence. The pain before the solution.

2. Go Deep
Hook angle: What is actually happening underneath. The layer most people never see.

3. Applications
Hook angle: Where this concept is silently running the world/some other concept domain right now.

4. Sequential progression:
Hook angle: The natural next question this topic forces you to ask.

5. Surprise Me
Hook angle: The same core mechanism appearing somewhere completely unexpected.

---
RULES:
1. Output only a JSON array of exactly 5 objects. No explanation, no keys, no wrapper object.
2. Every title must be mutually exclusive — no conceptual overlap between recommendations.
3. No title may overlap with existing siblings — check against the list strictly.
4. Never recommend something requiring knowledge more than one level above the current path.
5. Never use: "Introduction to", "Learn about", "Overview of", "Applications of", "Understanding X".
6. Each title should feel slightly incomplete — like the first half of a sentence the user's brain wants to finish.

---
OUTPUT FORMAT:
[
  {{"hook": "Why?", "concept": "..."}},
  {{"hook": "Go Deep", "concept": "..."}},
  {{"hook": "Applications", "concept": "..."}},
  {{"hook": "Sequential progression", "concept": "..."}},
  {{"hook": "Surprise Me", "concept": "..."}}
]"""

    return prompt


# ─────────────────────────────────────────────
# 4. LLM EXECUTION
# ─────────────────────────────────────────────

def mock_llm_call(current_node: dict) -> list:
    title = current_node['title']
    return [
        {"hook": "Why?", "concept": f"The hidden crisis that forced {title} into existence"},
        {"hook": "Go Deep", "concept": f"The invisible layer powering {title}"},
        {"hook": "Applications", "concept": f"How {title} is secretly running your browser right now"},
        {"hook": "Sequential progression", "concept": f"What happens when {title} runs out of space?"},
        {"hook": "Surprise Me", "concept": f"The biological equivalent of {title}"}
    ]

def call_llm(prompt: str, api_key: str = None, current_node: dict = None) -> list:
    gemini_key = api_key or os.getenv("GEMINI_API_KEY")

    if gemini_key:
        try:
            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel(
                'gemini-1.5-flash',
                generation_config={"response_mime_type": "application/json"}
            )
            response = model.generate_content(prompt)
            text = response.text.strip()
            if text.startswith("```"):
                text = re.sub(r"```json?\n?", "", text).replace("```", "")
            return json.loads(text)
        except Exception as e:
            print(f"[LLM] Gemini failed: {e} — falling back")

    print("[LLM] No valid API key found or APIs failed — using mock response")
    return mock_llm_call(current_node)


# ─────────────────────────────────────────────
# 5. VALIDATION + ROUTING
# ─────────────────────────────────────────────

def validate_and_route(llm_array: list, current_node: dict, visited_ids: list, index: VectorIndex) -> dict:
    result = {}
    
    exclude = set([current_node["id"]] + visited_ids)
    SIMILARITY_THRESHOLD = 0.55 

    # Look through exactly the first 5 items (safeguard in case Gemini sends extra)
    for i, item in enumerate(llm_array[:5]):
        card_key = f"card_{i+1}"
        hook_style = item.get("hook", "Sequential")
        concept = item.get("concept", "Unknown Concept")

        matches = index.search(concept, top_k=1, exclude_ids=list(exclude))

        if matches and matches[0][1] >= SIMILARITY_THRESHOLD:
            node_id = matches[0][0]
            is_new = False
            print(f"[ROUTE] '{concept[:20]}...' matched existing node {node_id} (Score: {matches[0][1]:.2f})")
            exclude.add(node_id) 
        else:
            node_id = None
            is_new = True
            print(f"[ROUTE] '{concept[:20]}...' is completely new. Flagged for creation.")

        result[card_key] = {
            "node_id": node_id,
            "style": hook_style,
            "concept": concept,
            "suggestion": concept, 
            "is_new_node": is_new
        }

    return result


# ─────────────────────────────────────────────
# 6. MAIN PIPELINE ENTRY POINT
# ─────────────────────────────────────────────

def get_suggestions(node_id: str,
                    visited_ids: list,
                    graph: dict,
                    sibling_map: dict,
                    index: VectorIndex,
                    api_key: str = None) -> dict:

    if node_id not in graph:
        return {"error": f"node_id '{node_id}' not found in graph"}

    current_node = graph[node_id]
    print(f"\n{'='*60}")
    print(f"[PIPELINE] Node: {current_node['title']}")

    prompt = build_prompt(current_node, graph, visited_ids, sibling_map)
    raw_array = call_llm(prompt, api_key=api_key, current_node=current_node)

    result = validate_and_route(raw_array, current_node, visited_ids, index)

    result["meta"] = {
        "current_node_id": node_id,
        "cards_generated": len(result)
    }

    return result