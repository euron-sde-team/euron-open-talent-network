# AI stub

A dependency-free fake of the OpenAI endpoints the API uses (`AI_PROVIDER=stub`, `MODERATION_PROVIDER=stub`).

- `POST /v1/moderations` returns OpenAI-shaped `results[0].category_scores`.
- Text markers set scores: `[[mod:harassment=0.97]]` (any category, several allowed). Default 0.01.
- An image URL containing `flag-image` scores `sexual=0.99`. Local signed media URLs
  (`/api/media/local/<payload>.<sig>`) hide the storage key in a base64url payload, so
  the stub decodes that payload and checks it too.
- `POST /v1/chat/completions` returns a structured profile proposal extracted from the text with plain rules
  (headline, roles, skills, links), so the import wizard can be exercised end to end.
- `POST /v1/audio/transcriptions` returns a fixed transcript for any audio upload.
- The marker `[[ai:fail]]` anywhere in the input answers 500, for error-path tests.
- `GET /health` answers `{ ok: true }`. Port: `PORT`, default 5109. Run: `pnpm start`.
