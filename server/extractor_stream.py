import pymupdf
import json
import re
import os
import tempfile

# ── CONSTANTS ─────────────────────────────────────────────────────────────────

NOISE_PREFIXES = [
    "example", "definition", "figure", "proof", "corollary",
    "lemma", "claim", "theorem", "remark", "note", "exercise",
    "problem", "solution", "table", "fig.", "def.", "prop.",
    "exercises", "problems", "selected solutions", "bibliography",
    "index", "preface", "contents", "acknowledgment",
    "question", "questions", "practice problem", "practice problems",
    "practice exercise", "practice", "test yourself", "self-test", "self test",
    "concept check", "quick check", "review question", "review questions",
    "chapter review", "homework", "try it", "try it yourself", "try this", 
    "answer", "answers", "check your understanding", "quiz", "assessment",
    "examples", "worked example", "sample problem", "case study",
    "illustration", "application", "mini-case",
    "notes", "remarks", "tip", "tips", "hint", "hints",
    "warning", "caution", "important", "remember", "key takeaway", "key takeaways",
    "summary", "chapter summary", "key terms", "vocabulary", "learning objective",
    "learning objectives", "objectives", "goals", "did you know",
    "figures", "fig ", "tables", "chart", "graph", 
    "diagram", "plate", "exhibit", "image", "source:",
    "proposition", "axiom", "postulate", "statement", "hypothesis",
    "equation", "eq.", "formula",
]

SKIP_ENRICHMENT = [
    "cover", "title", "copyright", "dedication", "contents", "preface",
    "index", "bibliography", "exercises", "problems", "solutions",
    "acknowledgment", "introduction", "statement", "table of contents", "acknowledgements",
    "foreword", "prologue", "epilogue", "glossary",
    "references", "works cited", "further reading", "suggested reading",
    "appendix", "appendices", "about the author", "credits", "photo credits",
    "title page", "half title"
]

# ── FILTERS ───────────────────────────────────────────────────────────────────

def is_noise(t):
    t = t.strip().lower()
    if any(t.startswith(p) for p in NOISE_PREFIXES):
        return True
    if len(t) < 3:
        return True
    return False

def is_spaced_title(t):
    tokens = t.strip().split()
    if len(tokens) < 3:
        return False
    single_chars = sum(1 for tok in tokens if len(tok) == 1)
    return single_chars / len(tokens) > 0.7

def strip_md_artifacts(t):
    t = re.sub(r'\*{1,2}(.*?)\*{1,2}', r'\1', t)
    t = re.sub(r'_{1,2}(.*?)_{1,2}', r'\1', t)
    return t.strip()

def normalize(t):
    return re.sub(r'[^a-z\s]', '', t.lower()).strip()

def is_toc_duplicate(title, toc_titles_normalized):
    norm = normalize(title)
    if not norm:
        return True
    norm_words = set(norm.split())
    if not norm_words:
        return True
    for toc_norm in toc_titles_normalized:
        toc_words = set(toc_norm.split())
        if not toc_words:
            continue
        overlap = len(norm_words & toc_words) / max(len(norm_words), len(toc_words))
        if overlap >= 0.75:
            return True
    return False

# ── TOC TREE HELPERS ──────────────────────────────────────────────────────────

def build_toc_tree(toc_list):
    result = []
    stack = []
    for entry in toc_list:
        level, title, page, *_ = entry
        node = {
            "title": title.strip(),
            "page": page,
            "level": level,
            "type": "toc",
            "children": []
        }
        while stack and stack[-1]["level"] >= level:
            stack.pop()
        if stack:
            stack[-1]["node"]["children"].append(node)
        else:
            result.append(node)
        stack.append({"level": level, "node": node})
    return result

def collect_all_toc_pages(nodes):
    pages = []
    for node in nodes:
        pages.append(node["page"])
        pages.extend(collect_all_toc_pages(node["children"]))
    return pages

def collect_all_toc_titles(nodes):
    titles = []
    for node in nodes:
        titles.append(normalize(node["title"]))
        titles.extend(collect_all_toc_titles(node["children"]))
    return titles

# ── DOCLING CHUNK EXTRACTOR ───────────────────────────────────────────────────

def extract_docling_chunk(pdf_path, start_page, end_page, converter):
    """Slices the PDF and runs Docling on just that range."""
    doc = pymupdf.open(pdf_path)
    chunk_doc = pymupdf.open()
    
    # Check boundaries to avoid PyMuPDF errors
    actual_end = min(end_page - 1, len(doc) - 1)
    if start_page - 1 > actual_end:
        return []
        
    chunk_doc.insert_pdf(doc, from_page=start_page-1, to_page=actual_end)
    
    temp_dir = tempfile.mkdtemp()
    temp_pdf_path = os.path.join(temp_dir, "temp_chunk.pdf")
    chunk_doc.save(temp_pdf_path)
    chunk_doc.close()
    doc.close()

    doc_data = converter.convert(temp_pdf_path).document.export_to_dict()

    flat = []
    for item in doc_data.get("texts", []):
        label = str(item.get("label", "")).lower()
        if label not in ["section_header", "title", "heading"]:
            continue

        title = item.get("text", "").strip()
        title = strip_md_artifacts(title)

        if not title or is_noise(title) or is_spaced_title(title):
            continue

        prov = item.get("prov", [])
        if prov:
            page = prov[0].get("page_no") + start_page - 1
            flat.append({"title": title, "page": page, "level": 1, "type": "subsection", "children": []})

    os.remove(temp_pdf_path)
    os.rmdir(temp_dir)
    
    return flat

# ── STREAMING GENERATOR ───────────────────────────────────────────────────────

async def stream_hybrid(pdf_path, converter):
    """
    Yields JSON chunks as NDJSON (Newline Delimited JSON).
    """
    doc = pymupdf.open(pdf_path)
    toc = doc.get_toc(simple=False)
    total_pages = len(doc)
    doc.close()

    if not toc:
        yield json.dumps({"status": "error", "message": "No TOC metadata found."}) + "\n"
        return

    # 1. Build and yield the initial TOC tree immediately
    tree = build_toc_tree(toc)
    all_pages = sorted(set(collect_all_toc_pages(tree)))
    toc_titles_normalized = collect_all_toc_titles(tree)
    
    yield json.dumps({
        "status": "init", 
        "message": "TOC extracted", 
        "tree": tree
    }) + "\n"

    # 2. Iterate over every TOC page interval and process chunk by chunk
    for i, start_page in enumerate(all_pages):
        end_page = all_pages[i+1] - 1 if i + 1 < len(all_pages) else total_pages
        
        # We yield a progress event so the frontend knows what's scanning
        yield json.dumps({
            "status": "processing",
            "range": [start_page, end_page],
            "message": f"Scanning pages {start_page} to {end_page}..."
        }) + "\n"
        
        # Extract headings for this specific interval
        raw_headings = extract_docling_chunk(pdf_path, start_page, end_page, converter)
        
        # Filter out duplicates
        valid_headings = [
            h for h in raw_headings
            if not is_toc_duplicate(h["title"], toc_titles_normalized)
        ]
        
        # If we found subheadings, yield them specifically for this range
        if valid_headings:
            yield json.dumps({
                "status": "enriched",
                "range": [start_page, end_page],
                "sub_headings": valid_headings
            }) + "\n"

    # 3. Signal completion
    yield json.dumps({"status": "complete", "message": "All pages scanned."}) + "\n"