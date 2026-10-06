# Benchmarks

**Search terms (#159).** `scripts/search-terms.ts` sends one name from each of #132's 408 hand-matched FoodData Central entries (ad28389) to the model, ten names a call, and counts a name as found when the matched FDC description contains every word of one of its terms, or of its head food. English and German names are the seed's; Spanish, French, Arabic and Korean are `scripts/search-terms.names.json`, written by Claude and not checked by a native speaker. A miss is not always wrong ("emmental" against FDC's "Cheese, swiss"), and a hit only means retrieval has a word to work with. Run on the VPS (4 of 6 EPYC cores, `num_thread` 4), prompt `terms-1`; `qwen3.5:4b` is the model in use.

| Model | en | de | es | fr | ar | ko | s per call of 10 |
|---|---|---|---|---|---|---|---|
| `qwen3.5:2b` | 92.6% | 67.7% | | | | | ~15 |
| `qwen3.5:4b` | 93.9% | 84.6% | 85.3% | 83.6% | 71.1% | 80.6% | ~25 |

The 4b misses that matter are wrong foods rather than near names: "Knoblauch" → chive, "poivron vert" → sweet potato, "chapelure" → baking powder, "nubes" (marshmallows) → clouds, "بيض" (egg) → egg white, "김" (laver) → kimchi. Arabic is the weakest. Three of the 164 calls in the es/fr/ar/ko run failed with HTTP 500 and count as misses: `llama-server` grew past the container's 8 GB limit and was OOM-killed, though the model is 3.4 GB.
