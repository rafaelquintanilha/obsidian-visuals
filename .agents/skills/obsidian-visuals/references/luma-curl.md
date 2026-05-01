# Luma Curl

Load a local `.env` file only when it exists. Keep API keys out of prompts and output.

```sh
set -a
[ -f .env ] && . ./.env
set +a
: "${LUMA_API_KEY:?Set LUMA_API_KEY in .env or environment}"
```

Generation request:

```sh
curl -sS https://agents.lumalabs.ai/v1/generations \
  -H "Authorization: Bearer $LUMA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "uni-1",
    "type": "image",
    "aspect_ratio": "16:9",
    "prompt": "PROMPT"
  }'
```

The create response normally returns an ID first. Poll the matching generation endpoint until the state is terminal:

```sh
curl -sS "https://agents.lumalabs.ai/v1/generations/$GENERATION_ID" \
  -H "Authorization: Bearer $LUMA_API_KEY" \
  -H "accept: application/json"
```

For UNI-1 image generations on the Agents API, the completed image URL is returned in `output[0].url`. If a different API family is used, confirm the documented retrieval endpoint first instead of guessing.

Recommended payload fields:

```json
{
  "model": "uni-1",
  "type": "image",
  "aspect_ratio": "16:9",
  "prompt": "..."
}
```

Optional grounding:

- `web_search: true` lets the Luma agent search the web and download reference images before generating.
- Use it only when the user approves web grounding for that specific generation.
- Prefer it for current/public visual subjects, real objects, places, people, or style references that should come from the web.
- Do not enable it by default for private notes, purely conceptual visuals, or when local vault context is enough.
- Mention in the report that web grounding was enabled.

Example with web grounding:

```json
{
  "model": "uni-1",
  "type": "image",
  "aspect_ratio": "16:9",
  "web_search": true,
  "prompt": "..."
}
```

Do not call Luma until the user approves generation for the specific prompt.
