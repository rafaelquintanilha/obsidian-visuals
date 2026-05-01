# Luma Reference Editing

Use this when the user asks to reuse, modify, relight, restyle, or make a variation of an existing image.

## Intent

Choose the reference mode before calling Luma:

- `type: "image_edit"` with `source`: edit one specific source image while preserving composition, subject, framing, and identity. Use for "same image, change lighting", "make it warmer", "remove this element", or "keep the scene".
- `image_ref`: use one or more images as visual references for content, composition, or subject. Use for "make another one like this" when exact preservation is not required.

If the user asks for a precise edit, prefer `type: "image_edit"` with `source`.

## Source URL Policy

Luma accepts either an HTTPS URL or inline base64 image data for `source` and `image_ref`. Resolve the source image in this order:

1. Reuse the previous Luma `output[0].url` when it is still available.
2. If the source came from Luma, fetch the generation object again and use the returned `output[0].url` if available.
3. For a local file, use inline base64 `data` with the correct `media_type`.
4. Use a user-owned public or signed URL, such as Cloudflare R2 or S3.
5. Use a public URL supplied by the user.
6. Use a disposable public file host only after explicit approval.

Never upload a local file without approval. Prefer inline base64 over uploading when the API accepts it and the file is reasonable to send in the request body. If upload is needed, approval must name:

- local file path
- upload provider
- whether the uploaded image will be public
- expected expiration or deletion behavior, if known

Disposable hosts are not the default. They are acceptable only for non-sensitive previews when the user explicitly approves that provider for that image.

## Prompt Shape

For edits, write two compact parts:

- `change`: the specific requested edit
- `preserve`: what must remain stable

Example:

```text
Change only the lighting to cool moonlight with silver-blue fill, softer deep shadows, and a faint rim light on the raised stone.

Preserve the same composition, scene, subject, framing, editorial style, no visible text, and no new symbolic elements.
```

## Curl Payload Patterns

The Agents API accepts the normal generation envelope. For reference edits, include the approved reference field in the JSON body.

Modify one source image:

```json
{
  "model": "uni-1",
  "type": "image_edit",
  "aspect_ratio": "16:9",
  "prompt": "Change only... Preserve...",
  "source": {
    "url": "HTTPS_IMAGE_URL"
  }
}
```

Use inline base64 source data for a local edit:

```json
{
  "model": "uni-1",
  "type": "image_edit",
  "aspect_ratio": "16:9",
  "prompt": "Change only... Preserve...",
  "source": {
    "data": "BASE64_IMAGE_DATA",
    "media_type": "image/png"
  }
}
```

Use images as looser references:

```json
{
  "model": "uni-1",
  "type": "image",
  "aspect_ratio": "16:9",
  "prompt": "Create a variation...",
  "image_ref": [
    {
      "url": "HTTPS_IMAGE_URL"
    }
  ]
}
```

If the endpoint rejects a reference field, stop and report the exact error. Do not try another upload provider or API shape without approval.

## Output Handling

Reference edits produce a new generated image. Save it only to `tmp/` unless the user approves saving the specific output to the vault.
