"""
NLP Pipeline — Node Click → Suggestions
========================================
Input  : node_id + visited_nodes[]
Output : 4 cards JSON (3 styled + 1 synthesis)

No external DB needed — works directly on the local JSON file.
Swap get_node() and vector_search() with your DB calls later.
"""

import json
import math
import random
import os
import re
from typing import Optional
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.feature_extraction.text import TfidfVectorizer

# ─────────────────────────────────────────────
# 1. LOAD & INDEX THE JSON
# ─────────────────────────────────────────────

def load_graph(json_path: str) -> dict:
    """
    Builds Hierarchical IDs (e.g., node_4, node_4_3, node_4_3_1)
    """
    with open(json_path) as f:
        raw = json.load(f)

    flat = {}

    def traverse(nodes, parent_id=None, path_prefix=""):
        for i, node in enumerate(nodes):
            # 1. Build the path string (e.g., "4_3_1")
            current_path = f"{path_prefix}{i}"
            
            # 2. Create the ID
            node_id = f"node_{current_path}"
            
            node["id"] = node_id
            node["parent_id"] = parent_id
            
            if "content" not in node or not node["content"]:
                node["content"] = node.get("title", "")

            # 3. Add to dictionary
            flat[node_id] = node

            # 4. Process children, passing down the current path with an underscore!
            children = node.pop("children", [])
            node["child_ids"] = traverse(children, parent_id=node_id, path_prefix=f"{current_path}_")
            
        return [n["id"] for n in nodes]

    # Kick it off with an empty prefix
    traverse(raw if isinstance(raw, list) else [raw])
    
    return flat


def build_sibling_map(graph: dict) -> dict:
    """
    For each node, find prev and next sibling by looking at parent's child_ids.
    Returns { node_id: { prev: id|None, next: id|None } }
    """
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
# 2. VECTOR INDEX (TF-IDF for local JSON)
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

    def search(self, query_text: str, top_k: int = 20,
               exclude_ids: list = None) -> list:
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
# 3. KEYWORD DENSITY 
# ─────────────────────────────────────────────

STOPWORDS = {
    "a","an","the","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could",
    "should","may","might","must","shall","to","of","in","for",
    "on","with","at","by","from","as","into","through","during",
    "this","that","these","those","it","its","they","their","we",
    "our","you","your","he","she","him","her","and","or","but",
    "not","no","so","if","than","then","there","here","when",
    "where","who","which","how","what","each","both","few","more",
    "most","other","some","such","only","same","also","just","because",
}

def keyword_density(text: str) -> float:
    if not text:
        return 0.0
    tokens = re.findall(r'\b[a-zA-Z]+\b', text.lower())
    if not tokens:
        return 0.0
    content = [t for t in tokens if t not in STOPWORDS and len(t) > 2]
    return len(content) / len(tokens)

def extract_keywords(text: str, top_n: int = 8) -> list:
    tokens = re.findall(r'\b[a-zA-Z]+\b', text.lower())
    freq = {}
    for t in tokens:
        if t not in STOPWORDS and len(t) > 3:
            freq[t] = freq.get(t, 0) + 1
    return [w for w, _ in sorted(freq.items(), key=lambda x: x[1], reverse=True)][:top_n]


# ─────────────────────────────────────────────
# 4. STYLE PREDICTION
# ─────────────────────────────────────────────

STYLES = ["keep_going", "go_all_in", "pull_back", "why_exist", "make_it_real"]

STYLE_INSTRUCTIONS = {
    "keep_going":    "Give a one-line takeaway from this node. Name the single best next node to read. Be brief and momentum-preserving.",
    "go_all_in":     "Break this topic into 2-3 sub-concepts the user should explore. Show what to dive into first and why.",
    "pull_back":     "Zoom out. Explain where this node fits in the bigger picture. What is the parent concept and why does it matter?",
    "why_exist":     "Explain the origin of this concept. What problem did it solve? What existed before it?",
    "make_it_real":  "Give one concrete real-world example of this concept in action. How would someone actually use or see this?",
}

STYLE_HOP_LIMITS = {
    "keep_going":   3,
    "pull_back":    3,
    "make_it_real": 5,
    "why_exist":    999,
    "go_all_in":    999,
}

def mid(x: float) -> float:
    return 1 - abs(x - 0.5) * 2

def predict_styles(node: dict, graph: dict) -> tuple:
    density = keyword_density(node.get("content", node.get("title", "")))

    max_children = max((len(n.get("child_ids", [])) for n in graph.values()), default=1)
    child_count   = len(node.get("child_ids", []))
    children_norm = child_count / max_children if max_children > 0 else 0

    edge_count     = child_count + (1 if node.get("parent_id") else 0)
    max_edges      = max_children + 1
    edges_norm     = edge_count / max_edges if max_edges > 0 else 0

    scores = {
        "keep_going":   (1 - density) * 0.5 + mid(edges_norm) * 0.5,
        "go_all_in":    children_norm * 0.6 + edges_norm * 0.4,
        "pull_back":    (1 - children_norm) * 0.6 + (1 - edges_norm) * 0.4,
        "why_exist":    density * 0.5 + (1 - children_norm) * 0.5,
        "make_it_real": (1 - density) * 0.4 + edges_norm * 0.6,
    }

    if child_count == 0 and edge_count <= 1:
        scores["keep_going"] += 0.4
        scores["make_it_real"] += 0.2

    ranked = sorted(scores, key=scores.get, reverse=True)
    style_1  = ranked[0]
    style_2  = ranked[1]
    wildcard = random.choice(ranked[2:]) 

    return style_1, style_2, wildcard, scores


# ─────────────────────────────────────────────
# 5. CONTEXT ASSEMBLY
# ─────────────────────────────────────────────

def hop_distance(node_a: dict, node_b: dict) -> int:
    ca = node_a.get("chapter_index", 0)
    cb = node_b.get("chapter_index", 0)
    diff = abs(ca - cb)
    if diff == 0: return 2
    elif diff == 1: return 4
    else: return diff * 3

def fetch_a_nodes(node_id: str, graph: dict, sibling_map: dict) -> dict:
    node = graph[node_id]
    siblings = sibling_map.get(node_id, {})
    full_text_nodes = []

    if node.get("parent_id") and node["parent_id"] in graph:
        full_text_nodes.append(graph[node["parent_id"]])
    if siblings.get("prev") and siblings["prev"] in graph:
        full_text_nodes.append(graph[siblings["prev"]])
    if siblings.get("next") and siblings["next"] in graph:
        full_text_nodes.append(graph[siblings["next"]])

    child_ids = node.get("child_ids", [])[:4]
    heading_nodes = [graph[cid] for cid in child_ids if cid in graph]

    return {"full_text": full_text_nodes, "headings": heading_nodes}

def fetch_b_nodes(current_node: dict, graph: dict,
                  index: VectorIndex, sibling_map: dict,
                  visited_ids: list, top_style: str,
                  n: int = 5) -> list:
    query = f"{current_node['title']} {current_node.get('content','')}"

    siblings = sibling_map.get(current_node["id"], {})
    a_ids = {
        current_node["id"],
        current_node.get("parent_id"),
        siblings.get("prev"),
        siblings.get("next"),
        *current_node.get("child_ids", [])[:4],
        *visited_ids,
    }
    a_ids = {x for x in a_ids if x}

    candidates = index.search(query, top_k=20, exclude_ids=list(a_ids))
    max_hops = STYLE_HOP_LIMITS.get(top_style, 5)
    scored = []

    for nid, sim in candidates:
        if nid not in graph: continue
        candidate = graph[nid]
        hops = hop_distance(current_node, candidate)

        if hops <= 2 or hops > max_hops:
            continue

        scored.append((nid, sim))

    return [graph[nid] for nid, _ in scored[:n]]


# ─────────────────────────────────────────────
# 6. TOKEN BUDGET MANAGEMENT
# ─────────────────────────────────────────────

def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)

def build_context_pool(a_nodes: dict, b_nodes: list,
                       max_tokens: int = 1600) -> dict:
    used = 0
    pool = {"full_text": [], "headings": [], "b_nodes": []}

    for node in a_nodes["full_text"]:
        t = estimate_tokens(node.get("content", node.get("title", "")))
        if used + t <= max_tokens:
            pool["full_text"].append(node)
            used += t

    for node in a_nodes["headings"]:
        t = estimate_tokens(node.get("title", ""))
        if used + t <= max_tokens:
            pool["headings"].append(node)
            used += t

    for node in b_nodes:
        if used + 30 <= max_tokens:
            pool["b_nodes"].append(node)
            used += 30

    pool["tokens_used"] = used
    return pool


# ─────────────────────────────────────────────
# 7. PROMPT BUILDER
# ─────────────────────────────────────────────

def build_prompt(current_node: dict, pool: dict,
                 styles: tuple, visited_ids: list) -> str:
    style_1, style_2, wildcard = styles

    full_text_block = ""
    for n in pool["full_text"]:
        full_text_block += f"\n[{n['title']}]\n{n.get('content', '')[:500]}\n"

    headings_block = ", ".join(
        n["title"] for n in pool["headings"]
    ) if pool["headings"] else "none"

    b_block = ""
    for n in pool["b_nodes"]:
        kws = extract_keywords(n.get("content", n.get("title", "")), top_n=5)
        b_block += f"\n- {n['title']} (p.{n.get('page','?')}): {', '.join(kws)}"

    pool_ids = (
        [n["id"] for n in pool["full_text"]] +
        [n["id"] for n in pool["headings"]] +
        [n["id"] for n in pool["b_nodes"]]
    )

    visited_str = str(visited_ids[-15:]) if visited_ids else "[]"

    prompt = f"""You are a learning assistant for a knowledge graph reading app.
The user just clicked a node. Generate 4 suggestion cards to guide their learning.

=== CURRENT NODE ===
ID: {current_node['id']}
Title: {current_node['title']}
Content: {current_node.get('content', '')[:600]}

=== CONTEXT POOL — A NODES (structural neighbours, full text) ===
{full_text_block if full_text_block else 'No structural neighbours available.'}

=== CONTEXT POOL — A NODES (children headings only) ===
{headings_block}

=== CONTEXT POOL — B NODES (semantic discoveries, headings + keywords) ==={b_block if b_block else 'No semantic matches found.'}

=== AVAILABLE NODE IDs IN POOL ===
{pool_ids}

=== YOUR TASK ===
Generate exactly 4 cards. Use the SAME context pool for all cards. Do NOT repeat suggestions.

Card 1 (Style: {style_1}): {STYLE_INSTRUCTIONS[style_1]}
 Pick the best matching node from the pool. Return its exact node_id.

Card 2 (Style: {style_2}): {STYLE_INSTRUCTIONS[style_2]}
 Pick a different node from the pool. Return its exact node_id.

Card 3 (Wildcard: {wildcard}): {STYLE_INSTRUCTIONS[wildcard]}
 Pick a different node from the pool. Return its exact node_id.

Card 4 (Synthesis): Look at the themes from cards 1, 2, and 3.
 Invent a NEW concept that connects them — something NOT in the pool.
 Write 1-2 sentences. This becomes a new node in the graph.
 Set node_id to null.

CONSTRAINTS:
- Do NOT suggest anything in this visited list: {visited_str}
- Each card must pick a DIFFERENT node from the pool
- node_id must be an exact id from the pool list above (except card 4)
- Return ONLY valid JSON. No prose before or after.

=== REQUIRED JSON FORMAT ===
{{
  "card_1": {{
    "node_id": "<exact id from pool>",
    "style": "{style_1}",
    "suggestion": "<1-2 sentence suggestion>"
  }},
  "card_2": {{
    "node_id": "<exact id from pool>",
    "style": "{style_2}",
    "suggestion": "<1-2 sentence suggestion>"
  }},
  "card_3": {{
    "node_id": "<exact id from pool>",
    "style": "{wildcard}",
    "suggestion": "<1-2 sentence suggestion>"
  }},
  "card_4": {{
    "node_id": null,
    "style": "synthesis",
    "concept": "<3-5 word concept title>",
    "suggestion": "<1-2 sentence description of new concept>",
    "is_new_node": true
  }}
}}"""

    return prompt


# ─────────────────────────────────────────────
# 8. MOCK LLM
# ─────────────────────────────────────────────

def mock_llm_call(prompt: str, pool: dict,
                  current_node: dict, styles: tuple) -> dict:
    style_1, style_2, wildcard = styles
    all_pool_nodes = (pool["full_text"] + pool["headings"] + pool["b_nodes"])
    picks = all_pool_nodes[:3] if len(all_pool_nodes) >= 3 else all_pool_nodes

    def get_pick(i):
        if i < len(picks): return picks[i]["id"]
        return all_pool_nodes[0]["id"] if all_pool_nodes else "node_unknown"

    mock_suggestions = {
        "keep_going":   f"The key takeaway here is the relationship between {current_node['title'].lower()} and memory organization. Move to the next section to see this in context.",
        "go_all_in":    f"Dig deeper into {current_node['title']} by exploring its sub-components: how data flows, how instructions are processed, and how the OS mediates all of it.",
        "pull_back":    f"Step back — {current_node['title']} is part of a larger system where every component depends on the others. See the parent chapter to understand the full architecture.",
        "why_exist":    f"{current_node['title']} exists because early systems had no clean abstraction layer between hardware and software. It solved the chaos of direct hardware manipulation.",
        "make_it_real": f"In practice, {current_node['title']} shows up every time you open a browser tab — the OS uses these exact principles to allocate memory and schedule your process.",
    }

    return {
        "card_1": {"node_id": get_pick(0), "style": style_1, "suggestion": mock_suggestions[style_1]},
        "card_2": {"node_id": get_pick(1), "style": style_2, "suggestion": mock_suggestions[style_2]},
        "card_3": {"node_id": get_pick(2), "style": wildcard, "suggestion": mock_suggestions[wildcard]},
        "card_4": {"node_id": None, "style": "synthesis", "concept": "Hardware-Software Contract", "suggestion": "Every layer of the system exists because hardware and software agreed on an abstraction contract.", "is_new_node": True}
    }


# ─────────────────────────────────────────────
# 9. REAL LLM CALL (WITH GEMINI SUPPORT)
# ─────────────────────────────────────────────

def call_llm(prompt: str, api_key: str = None,
             pool: dict = None, current_node: dict = None,
             styles: tuple = None) -> dict:
    
    gemini_key    = api_key or os.getenv("GEMINI_API_KEY")


    # 1. Try Gemini
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


    print("[LLM] No valid API key found or all APIs failed — using mock response")
    return mock_llm_call(prompt, pool, current_node, styles)


# ─────────────────────────────────────────────
# 10. VALIDATION + ROUTING
# ─────────────────────────────────────────────

def validate_and_route(result: dict, pool: dict,
                       graph: dict, index: VectorIndex) -> dict:
    pool_ids = set(
        n["id"] for n in
        pool["full_text"] + pool["headings"] + pool["b_nodes"]
    )

    FIND_OR_CREATE_THRESHOLD = 0.85

    for card_key in ["card_1", "card_2", "card_3"]:
        card = result.get(card_key, {})
        nid  = card.get("node_id")

        if not nid or nid not in pool_ids:
            fallback = (pool["full_text"] or pool["b_nodes"] or [None])[0]
            card["node_id"]       = fallback["id"] if fallback else None
            card["id_corrected"]  = True
            print(f"[ROUTE] {card_key}: hallucinated id '{nid}' — corrected to '{card['node_id']}'")

        result[card_key] = card

    card_4  = result.get("card_4", {})
    concept = card_4.get("concept", "")

    if concept:
        matches = index.search(concept, top_k=1)
        if matches and matches[0][1] >= FIND_OR_CREATE_THRESHOLD:
            existing_id          = matches[0][0]
            card_4["node_id"]    = existing_id
            card_4["is_new_node"] = False
            print(f"[ROUTE] Card 4: concept '{concept}' matched existing node '{existing_id}'")
        else:
            card_4["node_id"]    = None
            card_4["is_new_node"] = True
            print(f"[ROUTE] Card 4: '{concept}' is new — flagged for async node creation")

    result["card_4"] = card_4
    return result


# ─────────────────────────────────────────────
# 11. MAIN PIPELINE ENTRY POINT
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
    print(f"[PIPELINE] Visited: {len(visited_ids)} nodes")

    style_1, style_2, wildcard, scores = predict_styles(current_node, graph)
    styles = (style_1, style_2, wildcard)
    print(f"[STYLE] {style_1} | {style_2} | wildcard: {wildcard}")

    a_nodes = fetch_a_nodes(node_id, graph, sibling_map)
    b_nodes = fetch_b_nodes(
        current_node, graph, index, sibling_map,
        visited_ids, top_style=style_1
    )

    pool = build_context_pool(a_nodes, b_nodes, max_tokens=1600)
    prompt = build_prompt(current_node, pool, styles, visited_ids)

    raw_result = call_llm(prompt, api_key=api_key,
                          pool=pool, current_node=current_node, styles=styles)

    result = validate_and_route(raw_result, pool, graph, index)

    result["meta"] = {
        "current_node_id": node_id,
        "styles_used":     list(styles),
        "style_scores":    {k: round(v, 3) for k, v in scores.items()},
        "pool_size":       len(pool["full_text"]) + len(pool["headings"]) + len(pool["b_nodes"]),
        "tokens_used":     pool["tokens_used"],
    }

    return result


# ─────────────────────────────────────────────
# 12. ASYNC NODE CREATION (Card 4)
# ─────────────────────────────────────────────

def create_new_node(card_4: dict, parent_node_id: str,
                    graph: dict, index: VectorIndex) -> dict:
    import time
    new_id = f"ai_node_{int(time.time())}"

    new_node = {
        "id":            new_id,
        "title":         card_4.get("concept", "New Concept"),
        "content":       card_4.get("suggestion", ""),
        "page":          None,
        "level":         99,
        "is_ai_node":    True,
        "parent_id":     parent_node_id,
        "child_ids":     [],
        "chapter_index": graph[parent_node_id].get("chapter_index", 0)
                         if parent_node_id in graph else 0,
    }

    graph[new_id] = new_node
    index.add_node(new_node)

    if parent_node_id in graph:
        graph[parent_node_id].setdefault("child_ids", []).append(new_id)

    print(f"[NEW NODE] Created: '{new_node['title']}' → id: {new_id}")
    return new_node


# ─────────────────────────────────────────────
# 13. DEMO RUN
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("Loading graph...")
    # UPDATE THIS PATH TO YOUR ACTUAL JSON FILE FOR TESTING
    graph       = load_graph("/home/claude/sample_nodes.json") 
    sibling_map = build_sibling_map(graph)
    index       = VectorIndex(graph)

    print(f"Graph loaded: {len(graph)} nodes\n")

    test_node_id   = "node_2_3"
    visited        = ["node_2", "node_2_0"]

    result = get_suggestions(
        node_id     = test_node_id,
        visited_ids = visited,
        graph       = graph,
        sibling_map = sibling_map,
        index       = index,
        api_key     = None  
    )

    print("\n" + "="*60)
    print("FINAL OUTPUT:")
    print("="*60)
    print(json.dumps(result, indent=2))

    if result.get("card_4", {}).get("is_new_node"):
        print("\n[CARD 4 CLICKED] Creating new node asynchronously...")
        new_node = create_new_node(
            card_4        = result["card_4"],
            parent_node_id = test_node_id,
            graph         = graph,
            index         = index,
        )
        print(f"New node ready: {json.dumps(new_node, indent=2)}")
        print(f"\nGraph now has {len(graph)} nodes")