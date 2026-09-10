"""Build lib/reader/lexicon-fr.json from Lexique 3.83: inflected form → lemma.

Same source and conda/pip setup as build-frequency.py. For a form with several
readings (porte → porter / porte) the most frequent reading wins. Forms that
are their own lemma are omitted; the lemmatizer falls back to the surface form.

    conda activate lode-nlp && pip install pylexique && python db/seed/build-lexicon.py
"""
import csv, json, os, re, sys

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "lib", "reader", "lexicon-fr.json")
WORD_RE = re.compile(r"^[a-zàâäçéèêëîïôöùûüÿœæ]+(?:[-'][a-zàâäçéèêëîïôöùûüÿœæ]+)*$")
# Keep in sync with build-frequency.py so reader lemmas match seed atom keys.
MERGE = {"la": "le", "les": "le", "l'": "le", "une": "un", "des": "un", "du": "de", "au": "à", "aux": "à"}
DROP_CGRAM = {"LIA"}  # liaison fragments


def lexique_path():
    if len(sys.argv) > 1:
        return sys.argv[1]
    import pylexique  # type: ignore
    return os.path.join(os.path.dirname(pylexique.__file__), "Lexique383", "Lexique383.txt")


def num(s):
    return float(s.replace(",", ".")) if s else 0.0


scores = {}  # (form, lemma) -> summed frequency across grammatical categories
with open(lexique_path(), encoding="latin-1", newline="") as f:
    for row in csv.DictReader(f, delimiter="\t"):
        form, lemma, cgram = row["1_ortho"], row["3_lemme"], row["4_cgram"]
        if cgram in DROP_CGRAM or not WORD_RE.match(form) or not WORD_RE.match(lemma):
            continue
        if cgram.startswith(("ART", "PRE")):
            lemma = MERGE.get(lemma, lemma)
        scores[(form, lemma)] = scores.get((form, lemma), 0.0) + num(row["9_freqfilms2"]) + num(row["10_freqlivres"])

best = {}  # form -> (key, lemma)
for (form, lemma), score in scores.items():
    # Tie-break toward the identity reading so rare inflections don't hijack common words.
    key = (score, 1 if lemma == form else 0)
    if form not in best or key > best[form][0]:
        best[form] = (key, lemma)

# "" marks a form that is its own lemma, so the reader can tell attested words from unknown ones.
table = {form: ("" if lemma == form else lemma) for form, (_, lemma) in best.items()}
for form, lemma in MERGE.items():
    table[form] = lemma
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(table, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
print(f"wrote {len(table)} forms ({sum(1 for v in table.values() if v)} with a distinct lemma) to {OUT} ({os.path.getsize(OUT)//1024} KB)")
for w in ["est", "sont", "voudrais", "porte", "les", "du", "aux", "chevaux", "yeux", "suis", "faisait", "peut-être", "aujourd'hui"]:
    print(w, "→", table.get(w) or w)
