# Schemas

What the two libraries return, kept as a reference for fields the service does
not currently forward. This is not the service's own contract — that is
narrowed in `services/recipeat-fetcher/src/recipeat_fetcher/models.py` and
published at `/docs`.


## Ingredients_parser
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Generated schema for Root",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "name": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "text": {
              "type": "string"
            },
            "confidence": {
              "type": "number"
            },
            "starting_index": {
              "type": "number"
            }
          },
          "required": [
            "text",
            "confidence",
            "starting_index"
          ]
        }
      },
      "size": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string"
          },
          "confidence": {
            "type": "number"
          },
          "starting_index": {
            "type": "number"
          }
        },
        "required": [
          "text",
          "confidence",
          "starting_index"
        ]
      },
      "amount": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "quantity": {
              "type": "number"
            },
            "quantity_max": {
              "type": "number"
            },
            "unit": {
              "type": "string"
            },
            "text": {
              "type": "string"
            },
            "confidence": {
              "type": "number"
            },
            "starting_index": {
              "type": "number"
            },
            "APPROXIMATE": {
              "type": "boolean"
            },
            "SINGULAR": {
              "type": "boolean"
            },
            "RANGE": {
              "type": "boolean"
            },
            "MULTIPLIER": {
              "type": "boolean"
            },
            "PREPARED_INGREDIENT": {
              "type": "boolean"
            }
          },
          "required": [
            "quantity",
            "quantity_max",
            "unit",
            "text",
            "confidence",
            "starting_index",
            "APPROXIMATE",
            "SINGULAR",
            "RANGE",
            "MULTIPLIER",
            "PREPARED_INGREDIENT"
          ]
        }
      },
      "preparation": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string"
          },
          "confidence": {
            "type": "number"
          },
          "starting_index": {
            "type": "number"
          }
        },
        "required": [
          "text",
          "confidence",
          "starting_index"
        ]
      },
      "comment": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string"
          },
          "confidence": {
            "type": "number"
          },
          "starting_index": {
            "type": "number"
          }
        },
        "required": [
          "text",
          "confidence",
          "starting_index"
        ]
      },
      "purpose": {},
      "foundation_foods": {
        "type": "array",
        "items": {}
      },
      "sentence": {
        "type": "string"
      }
    },
    "required": [
      "name",
      "amount",
      "purpose",
      "foundation_foods",
      "sentence"
    ]
  }
}
```

## Recipe_scrapers

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Generated schema for Root",
  "type": "object",
  "properties": {
    "canonical_url": {
      "type": "string"
    },
    "category": {
      "type": "string"
    },
    "cook_time": {
      "type": "number"
    },
    "cuisine": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "host": {
      "type": "string"
    },
    "image": {
      "type": "string"
    },
    "ingredients": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "instructions": {
      "type": "string"
    },
    "instructions_list": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "keywords": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "language": {
      "type": "string"
    },
    "nutrients": {
      "type": "object",
      "properties": {
        "calories": {
          "type": "string"
        },
        "fatContent": {
          "type": "string"
        },
        "carbohydrateContent": {
          "type": "string"
        },
        "proteinContent": {
          "type": "string"
        },
        "saturatedFatContent": {
          "type": "string"
        },
        "sugarContent": {
          "type": "string"
        },
        "fiberContent": {
          "type": "string"
        },
        "sodiumContent": {
          "type": "string"
        },
        "cholesterolContent": {
          "type": "string"
        },
        "servingSize": {
          "type": "string"
        }
      },
      "required": [
        "calories",
        "fatContent",
        "carbohydrateContent",
        "proteinContent",
        "saturatedFatContent",
        "sugarContent",
        "fiberContent",
        "sodiumContent",
        "cholesterolContent",
        "servingSize"
      ]
    },
    "prep_time": {
      "type": "number"
    },
    "ratings": {
      "type": "number"
    },
    "ratings_count": {
      "type": "number"
    },
    "site_name": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "total_time": {
      "type": "number"
    },
    "yields": {
      "type": "string"
    }
  },
  "required": [
    "canonical_url",
    "category",
    "cook_time",
    "cuisine",
    "description",
    "host",
    "image",
    "ingredients",
    "instructions",
    "instructions_list",
    "keywords",
    "language",
    "nutrients",
    "prep_time",
    "ratings",
    "ratings_count",
    "site_name",
    "title",
    "total_time",
    "yields"
  ]
}
```
