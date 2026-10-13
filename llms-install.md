# Installing thicken as an MCP server

For an AI agent setting up thicken for its user.

## Requirements

- Node.js 22.18 or later. The server runs from npm with `npx`; nothing to clone.
- Optional: Chrome or Edge installed, for previews; `ffmpeg` on the `PATH`, for
  video; a vision endpoint, for uncropped photos (below).

## Add the server

```json
{
  "mcpServers": {
    "thicken": {
      "command": "npx",
      "args": ["-y", "thicken", "mcp"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

With a vision roster, which lets photos be uncropped and has the models read
what's printed, add an `env` block (all optional; ask the user for them, and
keep the key out of the chat):

```json
"env": {
  "THICKEN_VISION_URL": "https://openrouter.ai/api/v1",
  "THICKEN_VISION_KEY": "…",
  "THICKEN_VISION_MODELS": "primary-model,peer-model,backup-model"
}
```

## Check it

Two tools should appear: `thicken_make` and `thicken_profiles`. Call
`thicken_profiles`; it lists the kinds of object thicken makes.

## Troubleshooting

- **The server doesn't start in time:** the first `npx` run downloads the
  package; allow up to two minutes, or run `npx -y thicken --help` once first.
- **"needs a vision roster":** the photos need cropping, or set the `env` above.
- **No preview:** install Chrome or Edge.
