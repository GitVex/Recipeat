Prompts:
- Extract recipes into JSON with title, ingredients, portions and steps. Preserve quantities. Do not invent missing information.

Full res Image time: 4m 5s -> speed up by downsampling/cropping image
Small text time: 20s
Trimmed HTML site: 2m 17s

structures:
```json
{
    "language": "en",
    "ingredients": [
      {
        "id": "ingredient_1",
        "originalText": "1½ cups flour",
        "name": "flour",
        "quantity": {
          "value": 1.5,
          "unit": "cup",
          "unitSystem": null
        }
      }
    ]
  }
```


text parts:
````json
{
    "parts": [
      { "type": "text", "value": "Bake at " },
      {
        "type": "measurement",
        "quantity": "temperature_1"
      },
      { "type": "text", "value": " for 20 minutes." }
    ],
    "quantities": {
      "temperature_1": {
        "value": 180,
        "unit": "celsius",
        "kind": "temperature"
      }
    }
  }
```


Source → Structured extraction → Validation / normalization → Storage
                                                            ↓
                                                Translation when needed
                                                            ↓
                                                  Units + language in UI
