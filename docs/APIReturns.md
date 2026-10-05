# Library outputs

`recipe-scrapers` returns more than the fetcher forwards. Besides title, language, yields, image, times, site name, author, canonical URL, ingredients and instructions, it also has category, cuisine, description, keywords, nutrients and ratings. `ingredient-parser` returns name, size, amounts (with approximate, singular, range, multiplier and prepared-ingredient flags), preparation, comment, purpose and foundation foods, each with a confidence. The fetcher's own, narrower contract is in `services/recipeat-fetcher/src/recipeat_fetcher/models.py` and at its `/docs`.
