# Benchmarks

**Search terms (#159).** `scripts/search-terms.ts` sends one name from each of #132's 408 hand-matched FoodData Central entries (ad28389) to the model, ten names a call, and counts a name as found when the matched FDC description contains every word of one of its terms, or of its head food. English and German names are the seed's; Spanish, French, Arabic and Korean are `scripts/search-terms.names.json`, written by Claude and not checked by a native speaker. A miss is not always wrong ("emmental" against FDC's "Cheese, swiss"), and a hit only means retrieval has a word to work with. Run on the VPS (4 of 6 EPYC cores, `num_thread` 4), prompt `terms-1`; `qwen3.5:4b` is the model in use.

| Model | en | de | es | fr | ar | ko | s per call of 10 |
|---|---|---|---|---|---|---|---|
| `qwen3.5:2b` | 92.6% | 67.7% | | | | | ~15 |
| `qwen3.5:4b` | 93.9% | 84.6% | 85.3% | 83.6% | 71.1% | 80.6% | ~25 |

The 4b misses that matter are wrong foods rather than near names: "Knoblauch" → chive, "poivron vert" → sweet potato, "chapelure" → baking powder, "nubes" (marshmallows) → clouds, "بيض" (egg) → egg white, "김" (laver) → kimchi. Arabic is the weakest. Three of the 164 calls in the es/fr/ar/ko run failed with HTTP 500 and count as misses: `llama-server` grew past the container's 8 GB limit and was OOM-killed, though the model is 3.4 GB.

**Translation models and lookups (#159, #167).** Same entries, names and scoring. The translation models (`MedAIBase/Tencent-HY-MT1.5` 1.8b and 7b, `translategemma:4b`) get one name a call in their own prompt format, and their English is the only term, so a hit is stricter than above: no synonyms, no head. The lookups take the entry an exact match after #157's normalization finds, and its English as the term. Mealie's food seed (580 foods) is AGPL-3.0 and not used.

| Translation alone or lookup | en | de | es | fr | ar | ko | s per name |
|---|---|---|---|---|---|---|---|
| HY-MT1.5 1.8b | | 40.3% | | | | | 0.18 |
| HY-MT1.5 7b | | 53.2% | 41.4% | 47.5% | 45.1% | 60.0% | ~0.6 |
| `translategemma:4b` | | 68.4% | 63.0% | 66.4% | 52.0% | 63.5% | ~1.6 |
| Open Food Facts taxonomy | 80.6% | 67.2% | 56.9% | 62.5% | 27.0% | 24.5% | |
| Mealie food seed | 64.2% | 51.7% | 44.4% | 46.1% | 40.2% | 2.9% | |
| OFF or Mealie | 86.3% | 75.9% | 68.1% | 72.3% | 47.1% | 25.7% | |

The 1.8b's English sent on to `qwen3.5:4b` as `en` found 70.1% of German names, against 84.6% for qwen on the German itself; the translation's wrong foods carry through ("sahne" → stage, "backpulver" → backspray). TranslateGemma's misses are near names ("메밀가루", buckwheat flour → millet flour) and it was not run through qwen. None replaces qwen for #159; OFF goes in front of it as aliases (#167). One of the 1.8b's 41 qwen calls failed when `llama-server` was OOM-killed again, at 8.3 GB, 979 ms into the call.
