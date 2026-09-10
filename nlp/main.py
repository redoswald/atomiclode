"""Lode NLP service: French tokenization + lemmatization with spaCy.

Optional. The web app analyses passages with a built-in lookup lemmatizer; set
NLP_SERVICE_URL (and NLP_SERVICE_TOKEN) on the app to use this instead for
context-aware lemmas.

Local dev (conda env, pip inside it for the PyPI-only packages):

    conda create -n lode-nlp python=3.12
    conda activate lode-nlp
    pip install -r nlp/requirements.txt
    NLP_SERVICE_TOKEN=dev uvicorn main:app --app-dir nlp --reload

Deploy: the Dockerfile in this folder works on Railway or Fly.io. Set
NLP_SERVICE_TOKEN there and the same value in Vercel.

Contract (must match lib/reader/analyze.ts): concatenating pre + surface over
all tokens reproduces the input text exactly.
"""
import os
import re
import unicodedata

import spacy
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="lode-nlp")
nlp = spacy.load("fr_core_news_md", disable=["ner"])

# Keep in sync with db/seed/build-frequency.py so lemmas match seed atom keys.
MERGE = {"la": "le", "les": "le", "l'": "le", "une": "un", "des": "un", "du": "de", "au": "à", "aux": "à"}
NON_WORD_POS = {"PUNCT", "SPACE", "SYM", "NUM", "X", "PROPN"}
MAX_CHARS = 20000
WORD_RE = re.compile(r"^[^\W\d_]+(?:[-'’][^\W\d_]+)*[’']?$")


class AnalyzeRequest(BaseModel):
    text: str


def normalize(s: str) -> str:
    return s.lower().replace("œ", "oe").replace("æ", "ae").replace("’", "'")


def require_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.environ.get("NLP_SERVICE_TOKEN")
    if not expected:
        return
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="bad token")


@app.get("/health")
def health():
    return {"ok": True, "model": nlp.meta.get("name"), "version": nlp.meta.get("version")}


@app.post("/analyze", dependencies=[Depends(require_token)])
def analyze(req: AnalyzeRequest):
    text = req.text.replace("\r\n", "\n").replace("\r", "\n")
    if len(text) > MAX_CHARS:
        raise HTTPException(status_code=413, detail=f"text longer than {MAX_CHARS} characters")
    text = unicodedata.normalize("NFC", text)
    doc = nlp(text)

    sentences = [s.text.strip() for s in doc.sents if s.text.strip()]
    sent_index = {}
    idx = 0
    for s in doc.sents:
        if s.text.strip():
            sent_index[s.start] = idx
            idx += 1

    tokens = []
    cursor = 0
    current_sentence = 0
    for tok in doc:
        if tok.sent.start in sent_index:
            current_sentence = sent_index[tok.sent.start]
        if tok.is_space:
            continue
        pre = text[cursor:tok.idx]
        cursor = tok.idx + len(tok.text)
        # Elided forms ("l'", "qu'") are words too, which is_alpha would reject.
        is_word = bool(WORD_RE.match(tok.text)) and tok.pos_ not in NON_WORD_POS
        lemma = normalize(tok.lemma_) if is_word else ""
        if tok.pos_ in ("DET", "ADP"):
            lemma = MERGE.get(lemma, lemma)
        tokens.append({
            "pre": pre,
            "surface": tok.text,
            "lemma": lemma,
            "isWord": is_word,
            "sentenceIdx": current_sentence,
        })
    trailing = text[cursor:]
    if trailing:
        tokens.append({"pre": trailing, "surface": "", "lemma": "", "isWord": False, "sentenceIdx": current_sentence})
    return {"sentences": sentences, "tokens": tokens}
