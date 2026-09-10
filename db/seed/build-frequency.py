"""Build db/seed/frequency-fr.json from Lexique 3.83.

Lexique 3.83 (New, Pallier, Brysbaert, Ferrand) is CC BY-SA 4.0: http://www.lexique.org
The easiest way to obtain the file is the `pylexique` package, which bundles it.

Run inside the lode-nlp conda env (pip inside conda, not system Python):

    conda activate lode-nlp
    pip install pylexique
    python db/seed/build-frequency.py

Output: db/seed/frequency-fr.json — top N lemmas with a coarse POS, surface forms,
blended per-million frequency, and an empty gloss (filled by scripts/gloss-seed.ts).
"""
import csv, json, os, re, sys
from collections import defaultdict

N = 3000
OUT = os.path.join(os.path.dirname(__file__), "frequency-fr.json")
LEMMA_RE = re.compile(r"^[a-zàâäçéèêëîïôöùûüÿœæ]+(?:[-'][a-zàâäçéèêëîïôöùûüÿœæ]+)*$")

# Lexique "cgram" → coarse Universal POS. Anything unmapped is dropped.
CGRAM_TO_POS = {
    "NOM": "NOUN", "VER": "VERB", "AUX": "AUX", "ADJ": "ADJ", "ADV": "ADV",
    "PRE": "ADP", "CON": "CONJ", "ONO": "INTJ",
    "ART:def": "DET", "ART:ind": "DET",
    "ADJ:pos": "DET", "ADJ:dem": "DET", "ADJ:ind": "DET", "ADJ:int": "DET", "ADJ:num": "NUM",
    "PRO:per": "PRON", "PRO:dem": "PRON", "PRO:ind": "PRON", "PRO:int": "PRON",
    "PRO:pos": "PRON", "PRO:rel": "PRON",
}


def lexique_path():
    if len(sys.argv) > 1:
        return sys.argv[1]
    import pylexique  # type: ignore
    return os.path.join(os.path.dirname(pylexique.__file__), "Lexique383", "Lexique383.txt")


# Lexique keeps article/pronoun forms as their own lemmas; spaCy folds them. Follow spaCy
# so reader tokens (lemma "le") match seed atoms.
MERGE = {"la": "le", "les": "le", "l'": "le", "une": "un", "des": "un", "du": "de", "au": "à", "aux": "à"}


def num(s):
    return float(s.replace(",", ".")) if s else 0.0


lemmas = {}  # lemma -> {pos: {"score":float, "forms":{ortho:freq}}}
with open(lexique_path(), encoding="latin-1", newline="") as f:
    for row in csv.DictReader(f, delimiter="\t"):
        lemma, cgram, ortho = row["3_lemme"], row["4_cgram"], row["1_ortho"]
        pos = CGRAM_TO_POS.get(cgram)
        if pos in ("DET", "ADP"):
            lemma = MERGE.get(lemma, lemma)
        if not pos or not LEMMA_RE.match(lemma):
            continue
        # Blend film-subtitle and book frequencies (both per million) so the list
        # serves conversation and reading alike.
        score = (num(row["7_freqlemfilms2"]) + num(row["8_freqlemlivres"])) / 2
        e = lemmas.setdefault(lemma, {}).setdefault(pos, {"score": score, "forms": defaultdict(float), "gender": None})
        e["forms"][ortho] += num(row["9_freqfilms2"]) + num(row["10_freqlivres"])
        if pos == "NOUN" and row["14_islem"] == "1" and row["5_genre"] in ("m", "f"):
            e["gender"] = row["5_genre"]

rows = []
for lemma, by_pos in lemmas.items():
    pos, e = max(by_pos.items(), key=lambda kv: kv[1]["score"])
    forms = defaultdict(float)
    for pe in by_pos.values():
        for o, c in pe["forms"].items():
            forms[o] += c
    rows.append((lemma, pos, e["score"], [o for o, _ in sorted(forms.items(), key=lambda kv: -kv[1])[:8]], e["gender"]))

rows.sort(key=lambda r: -r[2])
out = [
    {"rank": i, "lemma": l, "pos": p, "gender": g, "forms": fs, "freqPerMillion": round(s, 2), "gloss": ""}
    for i, (l, p, s, fs, g) in enumerate(rows[:N], start=1)
]
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print(f"wrote {len(out)} lemmas to {OUT}")
for i in (0, 1, 2, 99, 499, 999, 1999, 2999):
    print(out[i])
