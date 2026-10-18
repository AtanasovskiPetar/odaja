# Odaja

A small local 3D home-design tool built to work with LLM agents. Model your flat,
place furniture, try layouts, and let Claude Code (or any agent) edit the design
with you.

```bash
bun install
bun run dev
```

See [AGENTS.md](AGENTS.md) for the project layout and
[docs/project-format.md](docs/project-format.md) for the file format.

## Working with AI

- **In the app:** open the chat (⌘J), pick a connection and model, and talk
  about your design. Bring your own API key (Anthropic, OpenAI, Gemini,
  OpenRouter) or a local model (Ollama, LM Studio), set up under the chat's ⚙.
  Keys stay in your browser and go only to their provider.
- **From Claude Code or Claude Desktop** (this is how to use a Claude
  subscription): with the app running, add the MCP server:

```bash
claude mcp add odaja -- bun /path/to/odaja/mcp/server.ts
```
